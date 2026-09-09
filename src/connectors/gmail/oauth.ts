import { createHash, randomBytes } from "node:crypto";
import { GMAIL_SCOPES } from "./manifest.ts";

export type GmailCredential = {
  accessToken: string;
  /**
   * Google issues one of these once, on the first consent, and never mentions
   * it again on a refresh. Losing it means the account has to be reconnected
   * by hand, so it is carried forward explicitly everywhere below.
   */
  refreshToken?: string;
  /** Epoch ms, already reduced by a safety margin. */
  expiresAt?: number;
};

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
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
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    // Without offline there is no refresh token at all, and the connection
    // dies an hour after it is made.
    access_type: "offline",
    // Google withholds the refresh token on a second consent unless asked
    // again, so reconnecting an account would otherwise produce a credential
    // that cannot be renewed.
    prompt: "consent",
  });
  return `${AUTHORIZE}?${query.toString()}`;
}

type FetchLike = typeof fetch;

/** Google's token endpoint takes a form, not JSON, and answers JSON either way. */
async function postToken(
  payload: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const res = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload).toString(),
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Google returned a non-JSON response: ${text.slice(0, 200)}`);
  }
  const error = typeof body.error === "string" ? body.error : "";
  if (error) {
    const description =
      typeof body.error_description === "string" ? body.error_description : error;
    // The one Google returns for a refresh token that has passed its seven
    // days, which is the ordinary end of a connection rather than a fault.
    if (error === "invalid_grant") {
      throw new Error(`Google will not renew this connection (${description}). Connect Gmail again.`);
    }
    throw new Error(description);
  }
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("Google did not return an access token");
  const expiresIn = Number(body.expires_in);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 - 60_000 : undefined,
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
): Promise<GmailCredential> {
  return postToken(
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
}

/**
 * A renewed access token, keeping the refresh token we already hold.
 *
 * Google's refresh response has no refresh_token in it. Taking the response at
 * face value, as the GitHub flow can, would store a credential with no way to
 * renew itself and break the account an hour later.
 */
export async function refreshCredential(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: FetchLike = fetch,
): Promise<GmailCredential> {
  const renewed = await postToken(
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  return { ...renewed, refreshToken: renewed.refreshToken ?? input.refreshToken };
}

export async function revokeCredential(
  credential: GmailCredential,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  // Revoking the refresh token takes the access token with it; the reverse is
  // not true, so the longer-lived one is what gets sent.
  const token = credential.refreshToken ?? credential.accessToken;
  await fetchImpl(`${REVOKE}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}
