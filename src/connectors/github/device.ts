import type { GithubCredential } from "./oauth.ts";

/**
 * GitHub's device flow: the app asks for a code, the person types it on
 * github.com, and the app polls until GitHub hands over a token. Nothing comes
 * back to the app's address, so the app needs none, and no client secret.
 * The OAuth app must have device flow turned on in its settings.
 */

type FetchLike = typeof fetch;

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInMs: number;
  intervalMs: number;
};

async function postJson(
  url: string,
  payload: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`GitHub returned a non-JSON response: ${text.slice(0, 200)}`);
  }
}

export async function requestDeviceCode(
  clientId: string,
  scopes: string[],
  fetchImpl: FetchLike = fetch,
): Promise<DeviceCode> {
  const body = await postJson(
    "https://github.com/login/device/code",
    { client_id: clientId, scope: scopes.join(" ") },
    fetchImpl,
  );
  const error = typeof body.error === "string" ? body.error : "";
  if (error) {
    const description = typeof body.error_description === "string" ? body.error_description : error;
    throw new Error(
      error === "unauthorized_client"
        ? "This GitHub app has device flow turned off. Turn it on in the app's settings on GitHub."
        : description,
    );
  }
  const deviceCode = typeof body.device_code === "string" ? body.device_code : "";
  const userCode = typeof body.user_code === "string" ? body.user_code : "";
  const verificationUri = typeof body.verification_uri === "string" ? body.verification_uri : "";
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("GitHub did not return a device code.");
  }
  const expiresIn = Number(body.expires_in);
  const interval = Number(body.interval);
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresInMs: (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900) * 1000,
    intervalMs: (Number.isFinite(interval) && interval > 0 ? interval : 5) * 1000,
  };
}

export type DevicePoll =
  | { state: "pending"; slowDown: boolean }
  | { state: "expired"; reason: string }
  | { state: "granted"; credential: GithubCredential };

export async function pollDeviceCode(
  clientId: string,
  deviceCode: string,
  fetchImpl: FetchLike = fetch,
): Promise<DevicePoll> {
  const body = await postJson(
    "https://github.com/login/oauth/access_token",
    {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    fetchImpl,
  );
  const error = typeof body.error === "string" ? body.error : "";
  if (error === "authorization_pending") return { state: "pending", slowDown: false };
  if (error === "slow_down") return { state: "pending", slowDown: true };
  if (error === "expired_token") {
    return { state: "expired", reason: "The code expired before it was entered." };
  }
  if (error === "access_denied") {
    return { state: "expired", reason: "The authorization was declined on GitHub." };
  }
  if (error) {
    const description = typeof body.error_description === "string" ? body.error_description : error;
    throw new Error(description);
  }
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("GitHub did not return an access token");
  const expiresIn = Number(body.expires_in);
  return {
    state: "granted",
    credential: {
      accessToken,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      expiresAt:
        Number.isFinite(expiresIn) && expiresIn > 0
          ? Date.now() + expiresIn * 1000 - 60_000
          : undefined,
    },
  };
}
