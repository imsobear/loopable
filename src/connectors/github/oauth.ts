import { createHash, randomBytes } from "node:crypto";
import { GITHUB_SCOPES } from "./manifest.ts";

export type GithubCredential = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms, already reduced by a safety margin. */
  expiresAt?: number;
};

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: GITHUB_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `https://github.com/login/oauth/authorize?${query.toString()}`;
}

type FetchLike = typeof fetch;

async function postToken(
  payload: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<GithubCredential> {
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`GitHub returned a non-JSON response: ${text.slice(0, 200)}`);
  }
  const error = typeof body.error === "string" ? body.error : "";
  if (error) {
    const description = typeof body.error_description === "string" ? body.error_description : error;
    throw new Error(description);
  }
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("GitHub did not return an access token");
  const expiresIn = Number(body.expires_in);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1000 - 60_000
        : undefined,
  };
}

export function exchangeCode(
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    verifier: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<GithubCredential> {
  return postToken(
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    fetchImpl,
  );
}

export function refreshCredential(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: FetchLike = fetch,
): Promise<GithubCredential> {
  return postToken(
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    },
    fetchImpl,
  );
}
