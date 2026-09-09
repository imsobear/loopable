import { afterEach, describe, expect, it, vi } from "vitest";

import { wechatRuntime } from "./runtime.ts";
import type { WechatCredential } from "./api.ts";

const account: WechatCredential = {
  botToken: "token",
  botId: "bot@im.bot",
  userId: "owner@im.wechat",
  baseUrl: "https://ilink.test",
};

type Sent = { url: string; body: Record<string, unknown> };

/** Answers getupdates once with `messages`, and records anything sent. */
function givenWechat(messages: unknown[], cursor = "next") {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url, body });
    if (url.endsWith("/getupdates")) {
      return new Response(JSON.stringify({ ret: 0, msgs: messages, get_updates_buf: cursor }));
    }
    return new Response(JSON.stringify({ ret: 0 }));
  });
  return sent;
}

function message(over: Record<string, unknown> = {}) {
  return {
    message_id: 1,
    from_user_id: "owner@im.wechat",
    message_type: 1,
    context_token: "ctx",
    item_list: [{ type: 1, text_item: { text: "what broke the build" } }],
    ...over,
  };
}

const poll = (settings: Record<string, unknown> = {}, cursor: string | null = null) =>
  wechatRuntime.poll!({
    workflowId: "wechat.ask",
    settings,
    credential: account,
    cursor,
  });

afterEach(() => vi.unstubAllGlobals());

describe("wechat poll", () => {
  it("keeps what someone typed, because the stream will not offer it twice", async () => {
    givenWechat([message()]);
    const { signals, cursor } = await poll();

    expect(signals).toEqual([
      {
        key: "msg#1",
        kind: "message",
        ref: "msg#1",
        title: "what broke the build",
        url: "",
        payload: {
          messageId: 1,
          fromUserId: "owner@im.wechat",
          contextToken: "ctx",
          text: "what broke the build",
        },
      },
    ]);
    expect(cursor).toBe("next");
  });

  it("carries the cursor back so the next look starts where this one stopped", async () => {
    const sent = givenWechat([], "moved");
    await poll({}, "here");
    expect(sent[0]!.body.get_updates_buf).toBe("here");
  });

  it("answers only its owner unless told otherwise", async () => {
    // The reply is a coding agent running on this machine. A bot can be
    // messaged by anyone, so a stranger getting one is the thing to prevent.
    givenWechat([message({ message_id: 2, from_user_id: "stranger@im.wechat" })]);
    expect((await poll()).signals).toEqual([]);

    givenWechat([message({ message_id: 2, from_user_id: "stranger@im.wechat" })]);
    expect((await poll({ askers: "anyone" })).signals).toHaveLength(1);
  });

  it("ignores what the bot itself said, and anything with no words in it", async () => {
    givenWechat([
      message({ message_id: 3, message_type: 2 }),
      message({ message_id: 4, item_list: [{ type: 2 }] }),
      message({ message_id: 5, item_list: [{ type: 1, text_item: { text: "   " } }] }),
    ]);
    expect((await poll()).signals).toEqual([]);
  });

  it("gives up on a quiet stream without losing its place", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      // A long poll that never answers: the caller has other rules to get to.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    vi.useFakeTimers();
    const pending = poll({}, "here");
    await vi.advanceTimersByTimeAsync(11_000);
    vi.useRealTimers();

    await expect(pending).resolves.toEqual({ signals: [], cursor: "here" });
  });
});

describe("wechat reply", () => {
  const item = {
    kind: "message" as const,
    ref: "msg#1",
    title: "what broke the build",
    url: "",
    context: [],
    carry: { toUserId: "owner@im.wechat", contextToken: "ctx" },
  };

  const reply = (body: string) =>
    wechatRuntime.applyAction!({ actionId: "wechat.reply", item, body, credential: account });

  it("echoes the token that says which conversation this belongs to", async () => {
    const sent = givenWechat([]);
    await reply("The lockfile is stale.");

    const msg = sent[0]!.body.msg as Record<string, unknown>;
    expect(sent[0]!.url).toContain("/sendmessage");
    expect(msg).toMatchObject({
      to_user_id: "owner@im.wechat",
      context_token: "ctx",
      from_user_id: "",
      message_type: 2,
    });
    expect(msg.item_list).toEqual([{ type: 1, text_item: { text: "The lockfile is stale." } }]);
  });

  it("splits a long answer rather than losing the end of it", async () => {
    const sent = givenWechat([]);
    const paragraph = `${"x".repeat(1200)}\n\n${"y".repeat(1200)}`;
    await reply(paragraph);

    const texts = sent.map(
      (call) =>
        (
          (call.body.msg as { item_list: Array<{ text_item: { text: string } }> }).item_list[0]!
            .text_item
        ).text,
    );
    expect(texts).toEqual(["x".repeat(1200), "y".repeat(1200)]);
    // A repeat must not be able to post the same piece twice.
    const ids = sent.map((call) => (call.body.msg as { client_id: string }).client_id);
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses when there is nobody to reply to", async () => {
    givenWechat([]);
    await expect(
      wechatRuntime.applyAction!({
        actionId: "wechat.reply",
        item: { ...item, carry: {} },
        body: "hello",
        credential: account,
      }),
    ).rejects.toThrow(/nobody to reply to/);
  });
});
