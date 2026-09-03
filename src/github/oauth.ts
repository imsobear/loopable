import { createHash, randomBytes } from "node:crypto";

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export type OAuthApp = {
  clientId: string;
  clientSecret?: string;
};

export type PendingOAuth = {
  state: string;
  verifier: string;
  origin: string;
  createdAt: number;
};

export const GITHUB_OAUTH_SCOPES = "repo notifications";

const PENDING_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const CALLBACK_PATH = "/oauth/github/callback";

export function callbackUrl(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

// GitHub matches loopback redirects ignoring the port, so the app is registered
// without one and any LOOPABLE_PORT works.
export const REGISTERED_CALLBACK_URL = `http://127.0.0.1${CALLBACK_PATH}`;

export function buildAuthorizeUrl(input: {
  clientId: string;
  origin: string;
  state: string;
  challenge: string;
}): string {
  const qs = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: callbackUrl(input.origin),
    scope: GITHUB_OAUTH_SCOPES,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `https://github.com/login/oauth/authorize?${qs.toString()}`;
}

export function beginAuthorize(
  origin: string,
  app: OAuthApp | null,
): { pending: PendingOAuth; redirect: string } {
  if (!app?.clientId) {
    throw new Error(
      "No OAuth client ID configured. Set LOOPABLE_GITHUB_CLIENT_ID for an OAuth App you created in GitHub settings.",
    );
  }
  const { verifier, challenge } = createPkce();
  const pending: PendingOAuth = {
    state: b64url(randomBytes(16)),
    verifier,
    origin,
    createdAt: Date.now(),
  };
  return {
    pending,
    redirect: buildAuthorizeUrl({
      clientId: app.clientId,
      origin,
      state: pending.state,
      challenge,
    }),
  };
}

export function assertPending(pending: PendingOAuth | null, state: string | null): PendingOAuth {
  if (!pending) throw new Error("No authorization in progress. Click Authorize GitHub again.");
  if (!state || state !== pending.state) {
    throw new Error("Authorization state mismatch. Click Authorize GitHub again.");
  }
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    throw new Error("Authorization expired. Click Authorize GitHub again.");
  }
  return pending;
}

type FetchLike = typeof fetch;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`GitHub OAuth: ${text.slice(0, 400)}`);
  }
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function exchangeCode(
  input: {
    clientId: string;
    clientSecret?: string;
    code: string;
    origin: string;
    verifier: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const payload: Record<string, string> = {
    client_id: input.clientId,
    code: input.code,
    redirect_uri: callbackUrl(input.origin),
    code_verifier: input.verifier,
  };
  if (input.clientSecret) payload.client_secret = input.clientSecret;
  const body = await readJson(
    await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (str(body, "error")) throw new Error(str(body, "error_description") || str(body, "error"));
  if (!str(body, "access_token")) throw new Error("GitHub did not return an access token");
  return tokenSetFrom(body);
}

export async function refreshAccessToken(
  input: { clientId: string; clientSecret?: string; refreshToken: string },
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const payload: Record<string, string> = {
    client_id: input.clientId,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  };
  if (input.clientSecret) payload.client_secret = input.clientSecret;
  const body = await readJson(
    await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (str(body, "error")) throw new Error(str(body, "error_description") || str(body, "error"));
  if (!str(body, "access_token")) throw new Error("GitHub did not refresh the access token");
  return tokenSetFrom(body);
}

function tokenSetFrom(body: Record<string, unknown>): TokenSet {
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: str(body, "access_token"),
    refreshToken: str(body, "refresh_token") || undefined,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 - 60_000 : undefined,
  };
}

export function resultHtml(origin: string, error?: string): string {
  const dest = error ? `${origin}/?github_error=${encodeURIComponent(error)}` : `${origin}/?connected=1`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta http-equiv="refresh" content="0;url=${dest}" /><title>Loopable</title></head>
<body><p><a href="${dest}">Continue to Loopable</a></p></body>
</html>`;
}
