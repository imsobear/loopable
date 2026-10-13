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
  /** Messages looked up one at a time, by id. */
  messages?: Record<string, Record<string, unknown>>;
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
    const one = /^\/im\/v1\/messages\/([^/]+)$/.exec(path)?.[1];
    if (one && init?.method !== "POST") {
      const message = handlers.messages?.[one];
      if (!message) return json({ code: 230011, msg: "message not found" });
      return json({ code: 0, data: { items: [message] } });
    }
    if (path.endsWith("/reply")) {
      return json({ code: 0, data: handlers.reply ?? { message_id: "om_reply", chat_id: "oc_eng" } });
    }
    return json({ code: 1, msg: "unknown" });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
      since: 1690000000000,
    });

  it("reads a group it has not seen from when the loop last looked", async () => {
    givenFeishu({
      chats: [
        { chat_id: "oc_eng", name: "eng" },
        { chat_id: "oc_quiet", name: "quiet" },
      ],
      history: {
        oc_eng: [
          {
            message_id: "om_before",
            create_time: "1690000000000",
            chat_id: "oc_eng",
            msg_type: "text",
            sender: { id: "ou_maya", sender_type: "user" },
            body: { content: "{\"text\":\"@_user_1 before the loop\"}" },
            mentions: [{ id: "ou_bot" }],
          },
          {
            message_id: "om_ask",
            create_time: "1690000030000",
            chat_id: "oc_eng",
            msg_type: "text",
            sender: { id: "ou_maya", sender_type: "user" },
            body: { content: "{\"text\":\"@_user_1 sent before the first look\"}" },
            mentions: [{ id: "ou_bot" }],
          },
        ],
      },
    });

    const { signals, cursor } = await poll(null);
    expect(signals.map((signal) => [signal.key, signal.at])).toEqual([["oc_eng:om_ask", 1690000030000]]);
    expect(cursor).toEqual({
      oc_eng: "1690000030000",
      oc_quiet: "1690000000000",
      threads: { om_ask: { chatId: "oc_eng", messageId: "om_ask", last: "1690000030000" } },
    });
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
        at: 1700000002000,
      },
    ]);
    expect(cursor).toEqual({
      oc_eng: "1700000003000",
      threads: { om_ask: { chatId: "oc_eng", messageId: "om_ask", last: "1700000002000" } },
    });
  });
});

describe("feishu threads", () => {
  const poll = (threads: Record<string, unknown>) =>
    feishuRuntime.poll!({
      workflowId: "feishu.ask",
      settings: {},
      credential: account,
      cursor: { oc_eng: "1700000000000", threads } as never,
      since: 1690000000000,
    });

  const said = (id: string, at: string, text: string, by: "ou_maya" | "bot", mention = false) => ({
    message_id: id,
    create_time: at,
    chat_id: "oc_eng",
    thread_id: "omt_1",
    msg_type: "text",
    sender: by === "bot" ? { id: "cli_app", sender_type: "app" } : { id: by, sender_type: "user" },
    body: { content: JSON.stringify({ text }) },
    ...(mention ? { mentions: [{ id: "ou_bot" }] } : {}),
  });

  it("answers a mention inside the thread its answer opened, with what came before", async () => {
    vi.useFakeTimers({ now: 1700000100000, toFake: ["Date"] });
    givenFeishu({
      chats: [{ chat_id: "oc_eng", name: "eng" }],
      messages: { om_ask: { message_id: "om_ask", thread_id: "omt_1" } },
      history: {
        omt_1: [
          said("om_ask", "1700000002000", "@_user_1 checkout 5xx", "ou_maya", true),
          said("om_answer", "1700000003000", "Cause: redis timeout", "bot"),
          said("om_more", "1700000004000", "@_user_1 since when?", "ou_maya", true),
          said("om_chat", "1700000005000", "thanks all", "ou_maya"),
        ],
      },
    });

    const { signals, cursor } = await poll({
      om_ask: { chatId: "oc_eng", messageId: "om_ask", last: "1700000002000" },
    });

    expect(signals.map((signal) => signal.key)).toEqual(["oc_eng:om_more"]);
    expect(signals[0]!.payload).toMatchObject({
      messageId: "om_more",
      earlier: [
        { by: "person", text: "@_user_1 checkout 5xx" },
        { by: "bot", text: "Cause: redis timeout" },
      ],
    });
    expect((cursor as { threads: unknown }).threads).toEqual({
      omt_1: { chatId: "oc_eng", messageId: "om_ask", threadId: "omt_1", last: "1700000005000" },
    });

    const item = await feishuRuntime.resolveWorkItem!({ url: "", payload: signals[0]!.payload ?? null, credential: account });
    expect(item.context[0]!.body).toBe(
      [
        "# Earlier in this thread",
        "",
        "**Them:** @_user_1 checkout 5xx",
        "",
        "**You:** Cause: redis timeout",
        "",
        "# What you were asked",
        "",
        "@_user_1 since when?",
        "",
      ].join("\n"),
    );
  });

  it("waits for a thread to open, and lets go of one that went quiet", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 1700000100000;
    vi.useFakeTimers({ now, toFake: ["Date"] });
    givenFeishu({
      chats: [],
      messages: { om_waiting: { message_id: "om_waiting" } },
    });

    const { signals, cursor } = await poll({
      om_waiting: { chatId: "oc_eng", messageId: "om_waiting", last: String(now - 60_000) },
      om_unanswered: { chatId: "oc_eng", messageId: "om_unanswered", last: String(now - 2 * day) },
      omt_old: { chatId: "oc_eng", messageId: "om_old", threadId: "omt_old", last: String(now - 8 * day) },
    });

    expect(signals).toEqual([]);
    expect((cursor as { threads: unknown }).threads).toEqual({
      om_waiting: { chatId: "oc_eng", messageId: "om_waiting", last: String(now - 60_000) },
    });
  });

  it("stops reading a thread that is gone, without failing the look", async () => {
    vi.useFakeTimers({ now: 1700000100000, toFake: ["Date"] });
    givenFeishu({ chats: [] });

    const { cursor } = await poll({
      om_deleted: { chatId: "oc_eng", messageId: "om_deleted", last: "1700000000000" },
    });

    expect((cursor as { threads: unknown }).threads).toEqual({});
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
      reply_in_thread: true,
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
