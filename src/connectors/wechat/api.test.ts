import { afterEach, describe, expect, it, vi } from "vitest";
import { isTransient } from "../errors.ts";
import {
  notifyStart,
  qrCodeStatus,
  requestQrCode,
  sendMessage,
  type WechatCredential,
} from "./api.ts";

type Reply = { status?: number; body?: unknown; throws?: boolean };

function givenWechat(reply: Reply): { seen: Array<{ url: string; init?: RequestInit }> } {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    if (reply.throws) throw new Error("getaddrinfo ENOTFOUND");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  return { seen };
}

const credential: WechatCredential = {
  botToken: "tok",
  botId: "bot-1",
  userId: "user-1",
  baseUrl: "https://ilinkai.weixin.qq.com",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking for a code", () => {
  it("names itself as Loopable and asks as a bot", async () => {
    const { seen } = givenWechat({ body: { ret: 0, qrcode: "abc", qrcode_img_content: "https://x/q" } });
    const code = await requestQrCode();

    expect(code).toEqual({ qrcode: "abc", url: "https://x/q" });
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers["iLink-App-Id"]).toBe("bot");
    expect(headers["X-WECHAT-UIN"]).toBeTruthy();
    // 0x00020408, the plugin release this client was written against.
    expect(headers["iLink-App-ClientVersion"]).toBe("132104");
    expect(seen[0].url).toContain("bot_type=3");
  });

  it("complains rather than returning half a code", async () => {
    givenWechat({ body: { ret: 0, qrcode: "abc" } });
    await expect(requestQrCode()).rejects.toThrow(/did not return a login code/);
  });

  it("treats WeChat being down as a bad minute, not a bad request", async () => {
    givenWechat({ throws: true });
    await expect(requestQrCode()).rejects.toSatisfy(isTransient);

    givenWechat({ status: 503 });
    await expect(requestQrCode()).rejects.toSatisfy(isTransient);
  });
});

describe("watching a code", () => {
  it("hands back the credential once it is confirmed", async () => {
    givenWechat({
      body: {
        status: "confirmed",
        bot_token: "secret",
        ilink_bot_id: "bot-9",
        ilink_user_id: "user-9",
        baseurl: "api.example.com",
      },
    });
    const status = await qrCodeStatus("abc", "https://ilinkai.weixin.qq.com");

    expect(status).toEqual({
      state: "confirmed",
      credential: {
        botToken: "secret",
        botId: "bot-9",
        userId: "user-9",
        // A bare host is made absolute, since that is what it means.
        baseUrl: "https://api.example.com",
      },
    });
  });

  it("follows the host WeChat moves the login to", async () => {
    givenWechat({ body: { status: "scaned_but_redirect", redirect_host: "other.example.com" } });
    const status = await qrCodeStatus("abc", "https://ilinkai.weixin.qq.com");
    expect(status).toMatchObject({ state: "waiting", host: "https://other.example.com" });
  });

  it("keeps waiting through a failed look, because a scan may still be coming", async () => {
    givenWechat({ throws: true });
    expect(await qrCodeStatus("abc", "https://a")).toEqual({ state: "waiting", host: "https://a" });
  });

  it("says a scan was seen so the phone is not scanned twice", async () => {
    givenWechat({ body: { status: "scaned" } });
    const status = await qrCodeStatus("abc", "https://a");
    expect(status).toMatchObject({ state: "waiting", hint: expect.stringContaining("phone") });
  });

  it("gives up only on the answers that cannot recover", async () => {
    for (const [status, expected] of [
      ["expired", undefined],
      ["verify_code_blocked", /verification attempts/],
      ["binded_redirect", /already bound/],
    ] as const) {
      givenWechat({ body: { status } });
      const outcome = await qrCodeStatus("abc", "https://a");
      expect(outcome.state).toBe("expired");
      if (expected) expect((outcome as { reason?: string }).reason).toMatch(expected);
    }
  });

  it("treats a confirmation with no token as a failed login", async () => {
    givenWechat({ body: { status: "confirmed" } });
    expect(await qrCodeStatus("abc", "https://a")).toMatchObject({ state: "expired" });
  });

  it("waits out an answer it has never heard of", async () => {
    givenWechat({ body: { status: "something_new" } });
    expect(await qrCodeStatus("abc", "https://a")).toMatchObject({ state: "waiting" });
  });

  it("does not send the bot token while logging in", async () => {
    const { seen } = givenWechat({ body: { status: "wait" } });
    await qrCodeStatus("abc", "https://a");
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("checking a stored login", () => {
  it("passes when WeChat still knows the token", async () => {
    const { seen } = givenWechat({ body: { ret: 0 } });
    await expect(notifyStart(credential)).resolves.toBeUndefined();
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("catches a dead token even though it is reported in the other field", async () => {
    // What the live API actually answers for a bad token: errcode, no ret. A
    // check reading only `ret` would call this a success.
    givenWechat({ body: { errcode: -14, errmsg: "session timeout" } });
    await expect(notifyStart(credential)).rejects.toThrow(/signed this bot out/);
  });

  it("says plainly when the bot has been signed out, whichever field says so", async () => {
    givenWechat({ body: { ret: -14 } });
    await expect(notifyStart(credential)).rejects.toThrow(/Connect again by scanning/);
  });

  it("passes on what WeChat said for anything else", async () => {
    givenWechat({ body: { ret: -4, errmsg: "GetTypingTicket rpc failed" } });
    await expect(notifyStart(credential)).rejects.toThrow("GetTypingTicket rpc failed");
  });

  it("does not read a zero in one field as success when the other refused", async () => {
    givenWechat({ body: { errcode: 0, ret: -4 } });
    await expect(notifyStart(credential)).rejects.toThrow(/refused the request \(-4\)/);
  });
});

describe("sending", () => {
  const send = { toUserId: "user-1", clientId: "c1", text: "hello" };

  it("explains a refused message nobody asked for", async () => {
    // What WeChat answers once too long has passed since the person last wrote
    // to the bot. On its own it reads as a fault in this program, and eleven
    // runs were recorded as failed under it before anyone could tell it apart
    // from a bug.
    givenWechat({ body: { ret: -1, errmsg: "prepare failed" } });
    await expect(sendMessage(credential, send)).rejects.toThrow(/last write to the bot/);
    await expect(sendMessage(credential, send)).rejects.toThrow(/prepare failed/);
  });

  it("says nothing about the window when answering somebody", async () => {
    givenWechat({ body: { ret: -1, errmsg: "prepare failed" } });
    const reply = { ...send, contextToken: "ctx" };
    await expect(sendMessage(credential, reply)).rejects.toThrow("prepare failed");
    await expect(sendMessage(credential, reply)).rejects.not.toThrow(/last write to the bot/);
  });

  it("still says a dead token is a dead token", async () => {
    givenWechat({ body: { errcode: -14 } });
    await expect(sendMessage(credential, send)).rejects.toThrow(/signed this bot out/);
  });
});
