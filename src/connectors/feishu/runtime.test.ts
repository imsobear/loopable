import { afterEach, describe, expect, it, vi } from "vitest";

import { feishuRuntime } from "./runtime.ts";
import type { FeishuCredential } from "./api.ts";

const account: FeishuCredential = {
  appId: "cli_app",
  appSecret: "secret",
  host: "feishu",
  botOpenId: "ou_bot",
  botName: "Loopable",
  tenantAccessToken: "t-good",
  expiresAt: Date.now() + 60_000,
};

type Call = { url: string; body?: Record<string, unknown> };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function givenFeishu(handlers: {
  token?: { token?: string; expire?: number; code?: number; msg?: string };
  bot?: unknown;
  chats?: Array<{ chat_id: string; name?: string }>;
  history?: Record<string, Array<Record<string, unknown>>>;
  reply?: { message_id: string; chat_id: string };
  send?: { message_id: string; chat_id: string };
}) {
  const sent: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis/, "").split("?")[0]!;
    const parsed = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    sent.push({ url, body: parsed });
    if (path === "/auth/v3/tenant_access_token/internal") {
      const token = handlers.token;
      if (token?.code && token.code !== 0) return json({ code: token.code, msg: token.msg });
      return json({
        code: 0,
        tenant_access_token: token?.token ?? "t-good",
        expire: token?.expire ?? 7200,
      });
    }
    if (path === "/bot/v3/info") {
      return json({
        code: 0,
        bot: handlers.bot ?? { activate_status: 2, app_name: "Loopable", open_id: "ou_bot" },
      });
    }
    if (path === "/im/v1/chats") {
      return json({ code: 0, data: { items: handlers.chats ?? [], has_more: false } });
    }
    if (path === "/im/v1/messages") {
      if (init?.method === "POST") {
        return json({ code: 0, data: handlers.send ?? { message_id: "om_sent", chat_id: "oc_eng" } });
      }
      const chat = new URL(url).searchParams.get("container_id") ?? "";
      return json({ code: 0, data: { items: handlers.history?.[chat] ?? [], has_more: false } });
    }
    if (path.endsWith("/reply")) {
      return json({ code: 0, data: handlers.reply ?? { message_id: "om_reply", chat_id: "oc_eng" } });
    }
    return json({ code: 1, msg: "unknown" });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("connectWithFields", () => {
  it("refuses a missing app id", async () => {
    await expect(
      feishuRuntime.auth.connectWithFields!({ appId: "", appSecret: "secret", host: "feishu" }),
    ).rejects.toThrow(/App ID/);
  });

  it("saves the bot the app belongs to", async () => {
    givenFeishu({
      bot: { activate_status: 2, app_name: "Loopable", open_id: "ou_bot", avatar_url: "https://img" },
    });
    await expect(
      feishuRuntime.auth.connectWithFields!({
        appId: " cli_app ",
        appSecret: " secret ",
        host: "feishu",
      }),
    ).resolves.toMatchObject({
      credential: {
        appId: "cli_app",
        appSecret: "secret",
        host: "feishu",
        botOpenId: "ou_bot",
        botName: "Loopable",
        avatarUrl: "https://img",
        tenantAccessToken: "t-good",
      },
      account: {
        id: "ou_bot",
        label: "Loopable",
        avatarUrl: "https://img",
      },
    });
  });
});

describe("feishu poll", () => {
  const poll = (cursor: unknown = { oc_eng: "1700000000000" }) =>
    feishuRuntime.poll!({
      workflowId: "feishu.ask",
      settings: {},
      credential: account,
      cursor: cursor as never,
    });

  it("records where each group is and does not replay old messages on the first look", async () => {
    givenFeishu({
      chats: [{ chat_id: "oc_eng", name: "eng" }],
      history: {
        oc_eng: [
          {
            message_id: "om_old",
            create_time: "1690000000000",
            chat_id: "oc_eng",
            msg_type: "text",
            sender: { id: "ou_maya", sender_type: "user" },
            body: { content: "{\"text\":\"@_user_1 old\"}" },
            mentions: [{ id: "ou_bot" }],
          },
        ],
      },
    });

    const { signals, cursor } = await poll(null);
    expect(signals).toEqual([]);
    expect(cursor).toEqual({ oc_eng: "1690000000000" });
  });

  it("keeps a group mention of the bot and skips chat and its own replies", async () => {
    givenFeishu({
      chats: [{ chat_id: "oc_eng", name: "eng" }],
      history: {
        oc_eng: [
          {
            message_id: "om_self",
            create_time: "1700000003000",
            chat_id: "oc_eng",
            msg_type: "text",
            sender: { id: "cli_app", sender_type: "app" },
            body: { content: "{\"text\":\"I already said this\"}" },
          },
          {
            message_id: "om_ask",
            create_time: "1700000002000",
            chat_id: "oc_eng",
            msg_type: "text",
            sender: { id: "ou_maya", sender_type: "user" },
            body: { content: "{\"text\":\"@_user_1 checkout 5xx\"}" },
            mentions: [{ key: "@_user_1", id: "ou_bot", name: "Loopable" }],
          },
          {
            message_id: "om_chat",
            create_time: "1700000001000",
            chat_id: "oc_eng",
            msg_type: "text",
            sender: { id: "ou_maya", sender_type: "user" },
            body: { content: "{\"text\":\"just chatting\"}" },
          },
        ],
      },
    });

    const { signals, cursor } = await poll();
    expect(signals).toEqual([
      {
        key: "oc_eng:om_ask",
        kind: "message",
        ref: "om_ask",
        title: "checkout 5xx",
        url: "https://applink.feishu.cn/client/chat/open?openChatId=oc_eng",
        payload: {
          chatId: "oc_eng",
          messageId: "om_ask",
          user: "ou_maya",
          text: "@_user_1 checkout 5xx",
        },
      },
    ]);
    expect(cursor).toEqual({ oc_eng: "1700000003000" });
  });
});

describe("feishu reply", () => {
  const source = {
    connectorId: "feishu" as const,
    kind: "message" as const,
    ref: "om_ask",
    title: "checkout 5xx",
    url: "https://applink.feishu.cn/client/chat/open?openChatId=oc_eng",
    carry: { chatId: "oc_eng", messageId: "om_ask" },
  };

  it("replies to the message that asked", async () => {
    const sent = givenFeishu({});
    const outcome = await feishuRuntime.applyAction!({
      actionId: "feishu.reply",
      target: {},
      source,
      body: "Cause: redis timeout",
      credential: account,
    });
    expect(sent.find((call) => call.url.endsWith("/reply"))?.body).toEqual({
      msg_type: "text",
      content: "{\"text\":\"Cause: redis timeout\"}",
    });
    expect(outcome.url).toBe("https://applink.feishu.cn/client/chat/open?openChatId=oc_eng");
  });

  it("needs a chat when the work did not start in Feishu", async () => {
    givenFeishu({});
    await expect(
      feishuRuntime.applyAction!({
        actionId: "feishu.reply",
        target: {},
        source: { ...source, connectorId: "github", ref: "acme/web#1", carry: undefined },
        body: "hello",
        credential: account,
      }),
    ).rejects.toThrow(/no Feishu chat/);
  });
});
