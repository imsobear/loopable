import { afterEach, describe, expect, it, vi } from "vitest";

import { slackRuntime } from "./runtime.ts";
import type { SlackCredential } from "./api.ts";

const account: SlackCredential = {
  botToken: "xoxb-good",
  teamId: "T1",
  team: "Acme",
  teamUrl: "https://acme.slack.com/",
  botUserId: "Ubot",
  botId: "B1",
};

type Call = { url: string; body?: Record<string, unknown> };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function givenSlack(handlers: {
  auth?: unknown;
  channels?: Array<{ id: string; name?: string; is_im?: boolean }>;
  history?: Record<string, Array<Record<string, unknown>>>;
  post?: { ts: string; channel: string };
}) {
  const sent: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace("https://slack.com/api/", "").split("?")[0]!;
    const parsed = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    sent.push({ url, body: parsed });
    if (path === "auth.test") return json(handlers.auth ?? { ok: false, error: "invalid_auth" });
    if (path === "conversations.list") {
      return json({ ok: true, channels: handlers.channels ?? [] });
    }
    if (path === "conversations.history") {
      const channel = new URL(url).searchParams.get("channel") ?? "";
      return json({ ok: true, messages: handlers.history?.[channel] ?? [] });
    }
    if (path === "chat.postMessage") {
      return json({ ok: true, ...(handlers.post ?? { ts: "9.0", channel: "Ceng" }) });
    }
    return json({ ok: false, error: "unknown_method" });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("connectWithFields", () => {
  it("refuses anything that is not a bot token", async () => {
    await expect(slackRuntime.auth.connectWithFields!({ botToken: "xoxp-user" })).rejects.toThrow(
      /Bot User OAuth Token/,
    );
  });

  it("saves the workspace the token belongs to", async () => {
    givenSlack({
      auth: {
        ok: true,
        url: "https://acme.slack.com/",
        team: "Acme",
        team_id: "T1",
        user_id: "Ubot",
        bot_id: "B1",
      },
    });
    await expect(slackRuntime.auth.connectWithFields!({ botToken: " xoxb-good " })).resolves.toEqual({
      credential: account,
      account: {
        id: "T1",
        label: "Acme",
        url: "https://acme.slack.com/",
      },
    });
  });
});

describe("slack poll", () => {
  const poll = (cursor: unknown = { Ceng: "100.0", Dmaya: "100.0" }) =>
    slackRuntime.poll!({
      workflowId: "slack.ask",
      settings: {},
      credential: account,
      cursor: cursor as never,
    });

  it("records where each channel is and does not replay old messages on the first look", async () => {
    givenSlack({
      channels: [
        { id: "Ceng", name: "eng" },
        { id: "Dmaya", is_im: true },
      ],
      history: {
        Ceng: [{ ts: "90.0", user: "Umaya", text: "<@Ubot> old mention" }],
        Dmaya: [{ ts: "91.0", user: "Umaya", text: "old dm" }],
      },
    });

    const { signals, cursor } = await poll(null);
    expect(signals).toEqual([]);
    expect(cursor).toEqual({ Ceng: "90.0", Dmaya: "91.0" });
  });

  it("keeps a channel mention of the bot and a DM, and skips its own replies", async () => {
    givenSlack({
      channels: [
        { id: "Ceng", name: "eng" },
        { id: "Dmaya", is_im: true },
      ],
      history: {
        Ceng: [
          { ts: "102.0", user: "Ubot", bot_id: "B1", text: "I already said this" },
          { ts: "101.0", user: "Umaya", text: "<@Ubot> checkout 5xx" },
          { ts: "100.5", user: "Umaya", text: "just chatting" },
        ],
        Dmaya: [{ ts: "103.0", user: "Umaya", text: "what broke checkout" }],
      },
    });

    const { signals, cursor } = await poll();
    expect(signals).toEqual([
      {
        key: "Ceng:101.0",
        kind: "message",
        ref: "Ceng:101.0",
        title: "checkout 5xx",
        url: "https://acme.slack.com/archives/Ceng/p1010",
        payload: {
          channel: "Ceng",
          ts: "101.0",
          user: "Umaya",
          text: "<@Ubot> checkout 5xx",
          threadTs: "101.0",
        },
      },
      {
        key: "Dmaya:103.0",
        kind: "message",
        ref: "Dmaya:103.0",
        title: "what broke checkout",
        url: "https://acme.slack.com/archives/Dmaya/p1030",
        payload: {
          channel: "Dmaya",
          ts: "103.0",
          user: "Umaya",
          text: "what broke checkout",
          threadTs: "103.0",
        },
      },
    ]);
    expect(cursor).toEqual({ Ceng: "102.0", Dmaya: "103.0" });
  });
});

describe("slack reply", () => {
  const source = {
    connectorId: "slack" as const,
    kind: "message" as const,
    ref: "Ceng:101.0",
    title: "checkout 5xx",
    url: "https://acme.slack.com/archives/Ceng/p1010",
    carry: { channel: "Ceng", ts: "101.0" },
  };

  it("replies in the thread that asked", async () => {
    const sent = givenSlack({});
    const outcome = await slackRuntime.applyAction!({
      actionId: "slack.reply",
      target: {},
      source,
      body: "Cause: redis timeout",
      credential: account,
    });
    expect(sent[0]!.body).toEqual({
      channel: "Ceng",
      text: "Cause: redis timeout",
      thread_ts: "101.0",
    });
    expect(outcome.url).toBe("https://acme.slack.com/archives/Ceng/p90");
  });

  it("needs a channel when the work did not start in Slack", async () => {
    givenSlack({});
    await expect(
      slackRuntime.applyAction!({
        actionId: "slack.reply",
        target: {},
        source: { ...source, connectorId: "github", ref: "acme/web#1", carry: undefined },
        body: "hello",
        credential: account,
      }),
    ).rejects.toThrow(/no Slack channel/);
  });
});
