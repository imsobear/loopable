import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appRoot, dataDir } from "./paths.ts";
import { refreshAccessToken, type OAuthApp, type PendingOAuth, type TokenSet } from "./github/oauth.ts";

const USER_SERVICE = "loopable.github";
const APP_SERVICE = "loopable.github.oauth-app";

export type GithubSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  login?: string;
};

function useKeychain(): boolean {
  return process.platform === "darwin" && process.env.LOOPABLE_KEYCHAIN !== "0";
}

function sessionFile(): string {
  return join(dataDir(), "github-session.json");
}

function oauthAppFile(): string {
  return join(dataDir(), "oauth-app.json");
}

// The app registration that ships with Loopable. A client on the user's machine
// cannot keep this secret, which GitHub accepts for public clients; PKCE is what
// secures the flow. See docs/rfc/0001 "GitHub identity".
function shippedOAuthAppFile(): string {
  return join(appRoot(), "config", "oauth-app.json");
}

function readOAuthAppFile(path: string): OAuthApp | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OAuthApp>;
    if (!parsed.clientId) return null;
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch {
    return null;
  }
}

function pendingFile(): string {
  return join(dataDir(), "oauth-pending.json");
}

function account(): string {
  return process.env.USER ?? "user";
}

function readKeychainRaw(service: string): string | null {
  try {
    const token = execFileSync(
      "security",
      ["find-generic-password", "-a", account(), "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return token || null;
  } catch {
    return null;
  }
}

function writeKeychainRaw(service: string, value: string): void {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-a", account(), "-s", service],
      { stdio: "ignore" },
    );
  } catch {
    // none stored yet
  }
  execFileSync(
    "security",
    ["add-generic-password", "-a", account(), "-s", service, "-w", value],
    { stdio: "ignore" },
  );
}

function deleteKeychain(service: string): void {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-a", account(), "-s", service],
      { stdio: "ignore" },
    );
  } catch {
    // none stored
  }
}

function writeSecretFile(path: string, json: string): void {
  writeFileSync(path, json, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function parseSession(raw: string): GithubSession {
  if (raw.startsWith("{")) return JSON.parse(raw) as GithubSession;
  return { accessToken: raw };
}

export function getGithubSession(): GithubSession | null {
  if (process.env.GITHUB_TOKEN) {
    return { accessToken: process.env.GITHUB_TOKEN };
  }
  if (useKeychain()) {
    const raw = readKeychainRaw(USER_SERVICE);
    if (raw) return parseSession(raw);
  }
  if (!existsSync(sessionFile())) return null;
  try {
    return JSON.parse(readFileSync(sessionFile(), "utf8")) as GithubSession;
  } catch {
    return null;
  }
}

export function setGithubSession(session: GithubSession): void {
  const json = JSON.stringify(session);
  if (useKeychain()) {
    writeKeychainRaw(USER_SERVICE, json);
    return;
  }
  writeSecretFile(sessionFile(), json);
}

export function clearGithubSession(): void {
  if (useKeychain()) deleteKeychain(USER_SERVICE);
  if (existsSync(sessionFile())) rmSync(sessionFile());
}

export function getOAuthApp(): OAuthApp | null {
  const fromEnvId = process.env.LOOPABLE_GITHUB_CLIENT_ID?.trim();
  const fromEnvSecret = process.env.LOOPABLE_GITHUB_CLIENT_SECRET?.trim();
  if (fromEnvId) {
    return { clientId: fromEnvId, clientSecret: fromEnvSecret || undefined };
  }
  if (useKeychain()) {
    const raw = readKeychainRaw(APP_SERVICE);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as OAuthApp;
        if (parsed.clientId) return parsed;
      } catch {
        // ignore
      }
    }
  }
  return readOAuthAppFile(oauthAppFile()) ?? readOAuthAppFile(shippedOAuthAppFile());
}

export function setOAuthApp(app: OAuthApp): void {
  const json = JSON.stringify({
    clientId: app.clientId.trim(),
    ...(app.clientSecret?.trim() ? { clientSecret: app.clientSecret.trim() } : {}),
  });
  if (useKeychain()) {
    writeKeychainRaw(APP_SERVICE, json);
    return;
  }
  writeSecretFile(oauthAppFile(), json);
}

export function mergeGithubSession(patch: GithubSession): GithubSession {
  const next = { ...getGithubSession(), ...patch };
  setGithubSession(next);
  return next;
}

export function getPendingOAuth(): PendingOAuth | null {
  if (!existsSync(pendingFile())) return null;
  try {
    return JSON.parse(readFileSync(pendingFile(), "utf8")) as PendingOAuth;
  } catch {
    return null;
  }
}

export function setPendingOAuth(pending: PendingOAuth): void {
  writeSecretFile(pendingFile(), JSON.stringify(pending));
}

export function clearPendingOAuth(): void {
  if (existsSync(pendingFile())) rmSync(pendingFile());
}

export function getGithubToken(): string | null {
  return getGithubSession()?.accessToken ?? null;
}

export async function getGithubAccessToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const session = getGithubSession();
  if (!session?.accessToken) return null;
  if (!session.expiresAt || Date.now() < session.expiresAt) return session.accessToken;
  // Expired. Without a refresh token and the app registration it cannot be renewed,
  // and reporting it as usable would leave the UI claiming a connection that 401s.
  const app = getOAuthApp();
  if (!session.refreshToken || !app) return null;
  try {
    const tokens: TokenSet = await refreshAccessToken({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      refreshToken: session.refreshToken,
    });
    mergeGithubSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    return tokens.accessToken;
  } catch {
    return null;
  }
}
