import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCode, refreshCredential } from "./oauth.ts";

function answering(body: unknown, status = 200) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

describe("buildAuthorizeUrl", () => {
  const url = () =>
    new URL(
      buildAuthorizeUrl({
        clientId: "client",
        redirectUri: "http://127.0.0.1:4321/api/connectors/gmail/callback",
        state: "state",
        challenge: "challenge",
      }),
    );

  it("asks for a code with PKCE", () => {
    const params = url().searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge")).toBe("challenge");
    expect(params.get("code_challenge_method")).toBe("S256");
  });

  /**
   * Both of these are the difference between a connection that survives the
   * hour and one that does not, and neither is Google's default.
   */
  it("asks for offline access, and asks again on a reconnect", () => {
    expect(url().searchParams.get("access_type")).toBe("offline");
    expect(url().searchParams.get("prompt")).toBe("consent");
  });

  it("asks only to read mail", () => {
    expect(url().searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
  });
});

describe("exchangeCode", () => {
  it("posts a form, because Google will not take JSON here", async () => {
    const fetchImpl = answering({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    await exchangeCode(
      {
        clientId: "client",
        clientSecret: "secret",
        code: "code",
        redirectUri: "http://127.0.0.1/cb",
        verifier: "verifier",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code_verifier")).toBe("verifier");
  });

  it("keeps the refresh token and dates the access token", async () => {
    const credential = await exchangeCode(
      {
        clientId: "c",
        clientSecret: "s",
        code: "code",
        redirectUri: "http://127.0.0.1/cb",
        verifier: "v",
      },
      answering({ access_token: "at", refresh_token: "rt", expires_in: 3600 }) as unknown as typeof fetch,
    );
    expect(credential.accessToken).toBe("at");
    expect(credential.refreshToken).toBe("rt");
    expect(credential.expiresAt).toBeGreaterThan(Date.now());
  });

  it("reports what Google said rather than a bare status", async () => {
    await expect(
      exchangeCode(
        { clientId: "c", clientSecret: "s", code: "bad", redirectUri: "u", verifier: "v" },
        answering(
          { error: "invalid_request", error_description: "Missing code verifier" },
          400,
        ) as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Missing code verifier");
  });
});

describe("refreshCredential", () => {
  /**
   * The whole reason this is not GitHub's refresh. Google answers a refresh
   * without repeating the refresh token, so taking the response at face value
   * would store a credential that cannot renew itself again and break the
   * account an hour later.
   */
  it("carries the refresh token forward when Google does not repeat it", async () => {
    const credential = await refreshCredential(
      { clientId: "c", clientSecret: "s", refreshToken: "original" },
      answering({ access_token: "new", expires_in: 3600 }) as unknown as typeof fetch,
    );
    expect(credential.accessToken).toBe("new");
    expect(credential.refreshToken).toBe("original");
  });

  it("takes a replacement when Google does send one", async () => {
    const credential = await refreshCredential(
      { clientId: "c", clientSecret: "s", refreshToken: "original" },
      answering({
        access_token: "new",
        refresh_token: "rotated",
        expires_in: 3600,
      }) as unknown as typeof fetch,
    );
    expect(credential.refreshToken).toBe("rotated");
  });

  /**
   * What the seven-day expiry of an unverified app looks like from here. It is
   * the ordinary end of a connection rather than a fault, so it says what to
   * do about it.
   */
  it("explains an expired grant instead of passing the code along", async () => {
    await expect(
      refreshCredential(
        { clientId: "c", clientSecret: "s", refreshToken: "stale" },
        answering(
          { error: "invalid_grant", error_description: "Token has been expired or revoked." },
          400,
        ) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/Connect Gmail again/);
  });
});
