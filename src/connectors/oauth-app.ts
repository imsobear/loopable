import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type OAuthAppRegistration = {
  clientId: string;
  clientSecret: string;
};

/**
 * The OAuth app a connector signs in and connects with: from env when hosted
 * (Worker secrets), or from gitignored config/oauth-app.json when developing.
 * Nothing is built in, so no app's secret lives in the repository; without
 * one, signing in with that provider says plainly that it is not set up.
 */
export function oauthAppRegistration(connectorId: string): OAuthAppRegistration | null {
  return fromEnv(connectorId) ?? fromFile(connectorId);
}

/** LOOPABLE_GITHUB_CLIENT_ID and friends. */
function fromEnv(connectorId: string): OAuthAppRegistration | null {
  const prefix = `LOOPABLE_${connectorId.toUpperCase()}_CLIENT_`;
  return pick(process.env[`${prefix}ID`], process.env[`${prefix}SECRET`]);
}

/**
 * config/oauth-app.json, gitignored. Either an object per
 * connector or, for GitHub alone, the two keys at the top level.
 */
function fromFile(connectorId: string): OAuthAppRegistration | null {
  let file: string;
  try {
    file = join(process.cwd(), "config", "oauth-app.json");
    if (!existsSync(file)) return null;
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const nested = parsed[connectorId];
  if (nested && typeof nested === "object") {
    const entry = nested as Partial<OAuthAppRegistration>;
    return pick(entry.clientId, entry.clientSecret);
  }
  if (connectorId !== "github") return null;
  const flat = parsed as Partial<OAuthAppRegistration>;
  return pick(flat.clientId, flat.clientSecret);
}

function pick(id: unknown, secret: unknown): OAuthAppRegistration | null {
  const clientId = typeof id === "string" ? id.trim() : "";
  const clientSecret = typeof secret === "string" ? secret.trim() : "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
