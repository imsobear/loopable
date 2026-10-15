import { describe, expect, it } from "vitest";
import { pollDeviceCode, requestDeviceCode } from "./device.ts";

function answering(body: unknown, calls: Array<{ url: string; body: unknown }> = []) {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("GitHub device flow", () => {
  it("asks for a code with the scopes, and reads what to show", async () => {
    const { fetchImpl, calls } = answering({
      device_code: "dev-1",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    const code = await requestDeviceCode("client-1", ["repo", "notifications"], fetchImpl);
    expect(code).toEqual({
      deviceCode: "dev-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresInMs: 900_000,
      intervalMs: 5_000,
    });
    expect(calls[0]).toEqual({
      url: "https://github.com/login/device/code",
      body: { client_id: "client-1", scope: "repo notifications" },
    });
  });

  it("says when device flow is off for the app", async () => {
    for (const error of ["unauthorized_client", "device_flow_disabled"]) {
      const { fetchImpl } = answering({ error, error_description: "nope" });
      await expect(requestDeviceCode("client-1", ["repo"], fetchImpl)).rejects.toThrow(/device flow turned off/);
    }
  });

  it("keeps waiting while the code is not entered, and slows down when told", async () => {
    expect(await pollDeviceCode("c", "d", answering({ error: "authorization_pending" }).fetchImpl)).toEqual({
      state: "pending",
      slowDown: false,
    });
    expect(await pollDeviceCode("c", "d", answering({ error: "slow_down" }).fetchImpl)).toEqual({
      state: "pending",
      slowDown: true,
    });
  });

  it("gives up on an expired or declined code", async () => {
    expect(await pollDeviceCode("c", "d", answering({ error: "expired_token" }).fetchImpl)).toMatchObject({
      state: "expired",
    });
    expect(await pollDeviceCode("c", "d", answering({ error: "access_denied" }).fetchImpl)).toMatchObject({
      state: "expired",
    });
  });

  it("hands over the token once it is granted, without a client secret", async () => {
    const { fetchImpl, calls } = answering({ access_token: "gho_x", expires_in: 3600, refresh_token: "ghr_y" });
    const outcome = await pollDeviceCode("client-1", "dev-1", fetchImpl);
    expect(outcome.state).toBe("granted");
    if (outcome.state !== "granted") return;
    expect(outcome.credential.accessToken).toBe("gho_x");
    expect(outcome.credential.refreshToken).toBe("ghr_y");
    expect(outcome.credential.expiresAt).toBeGreaterThan(Date.now());
    expect(calls[0]!.body).toEqual({
      client_id: "client-1",
      device_code: "dev-1",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
  });
});
