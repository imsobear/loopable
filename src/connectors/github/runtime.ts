import { defineRuntime } from "../define.ts";
import type { ConnectorAccount } from "../types.ts";
import { getViewer } from "./api.ts";
import { githubAppRegistration } from "./app-registration.ts";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  refreshCredential,
  type GithubCredential,
} from "./oauth.ts";

function requireRegistration() {
  const registration = githubAppRegistration();
  if (!registration) {
    throw new Error("GitHub is not configured in this build: the OAuth app registration is missing.");
  }
  return registration;
}

function accountFrom(user: Awaited<ReturnType<typeof getViewer>>): ConnectorAccount {
  return {
    id: String(user.user.id),
    label: user.user.login,
    url: user.user.html_url,
    avatarUrl: user.user.avatar_url,
    scopes: user.scopes,
  };
}

/**
 * Returns a usable access token, refreshing it when the stored one has expired.
 * The refreshed credential is handed back so the caller can persist it.
 */
export async function usableToken(
  credential: GithubCredential,
): Promise<{ accessToken: string; refreshed?: GithubCredential }> {
  const stillValid = !credential.expiresAt || Date.now() < credential.expiresAt;
  if (stillValid) return { accessToken: credential.accessToken };
  if (!credential.refreshToken) {
    throw new Error("The GitHub token expired and there is no refresh token. Reconnect the account.");
  }
  const registration = requireRegistration();
  const refreshed = await refreshCredential({
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    refreshToken: credential.refreshToken,
  });
  return { accessToken: refreshed.accessToken, refreshed };
}

export const githubRuntime = defineRuntime({
  async readiness() {
    if (githubAppRegistration()) return { ready: true };
    return {
      ready: false,
      reason: "This build has no GitHub app registration.",
      fixHint:
        "Add config/oauth-app.json, or set LOOPABLE_GITHUB_CLIENT_ID and LOOPABLE_GITHUB_CLIENT_SECRET.",
    };
  },
  auth: {
    async startAuthorization({ redirectUri, state }) {
      const registration = requireRegistration();
      const { verifier, challenge } = createPkce();
      return {
        verifier,
        redirectUrl: buildAuthorizeUrl({
          clientId: registration.clientId,
          redirectUri,
          state,
          challenge,
        }),
      };
    },
    async completeAuthorization({ code, redirectUri, verifier }) {
      const registration = requireRegistration();
      const credential = await exchangeCode({
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
        code,
        redirectUri,
        verifier,
      });
      const viewer = await getViewer(credential.accessToken);
      return { credential, account: accountFrom(viewer) };
    },
    async identity(credential) {
      const { accessToken, refreshed } = await usableToken(credential as GithubCredential);
      const account = accountFrom(await getViewer(accessToken));
      return refreshed ? { account, renewedCredential: refreshed } : { account };
    },
  },
});
