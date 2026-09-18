import { afterEach, describe, expect, it, vi } from "vitest";

import { authTest, history, listConversations, postMessage } from "./api.ts";

afterEach(() => vi.unstubAllGlobals());

function slackOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("authTest", () => {
  it("keeps the bot and workspace from a valid token", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://slack.com/api/auth.test");
      expect(init.headers).toMatchObject({ Authorization: "Bearer xoxb-good" });
      return slackOk({
        ok: true,
        url: "https://acme.slack.com/",
        team: "Acme",
        team_id: "T1",
        user_id: "Ubot",
        bot_id: "B1",
      });
    });

    await expect(authTest("xoxb-good")).resolves.toEqual({
      botToken: "xoxb-good",
      teamId: "T1",
      team: "Acme",
      teamUrl: "https://acme.slack.com/",
      botUserId: "Ubot",
      botId: "B1",
    });
  });

  it("says the token is wrong when Slack refuses it", async () => {
    vi.stubGlobal("fetch", async () => slackOk({ ok: false, error: "invalid_auth" }));
    await expect(authTest("xoxb-bad")).rejects.toThrow(/did not accept that token/);
  });
});

describe("listConversations", () => {
  const account = {
    botToken: "xoxb-good",
    teamId: "T1",
    team: "Acme",
    teamUrl: "https://acme.slack.com/",
    botUserId: "Ubot",
    botId: "B1",
  };

  it("asks for the channels and DMs the bot is in", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toContain("conversations.list");
      expect(decodeURIComponent(url)).toContain("types=public_channel,private_channel,im,mpim");
      return slackOk({
        ok: true,
        channels: [
          { id: "Ceng", name: "eng", is_im: false },
          { id: "Dmaya", name: "", is_im: true },
        ],
      });
    });

    await expect(listConversations(account)).resolves.toEqual([
      { id: "Ceng", name: "eng", isIm: false },
      { id: "Dmaya", name: "", isIm: true },
    ]);
  });
});

describe("history", () => {
  const account = {
    botToken: "xoxb-good",
    teamId: "T1",
    team: "Acme",
    teamUrl: "https://acme.slack.com/",
    botUserId: "Ubot",
    botId: "B1",
  };

  it("reads messages newer than the cursor, oldest first", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toContain("conversations.history");
      expect(url).toContain("channel=Ceng");
      expect(url).toContain("oldest=100.0");
      return slackOk({
        ok: true,
        messages: [
          { ts: "102.0", user: "Umaya", text: "<@Ubot> look at this" },
          { ts: "101.0", user: "Umaya", text: "hello" },
        ],
      });
    });

    await expect(history(account, "Ceng", "100.0")).resolves.toEqual([
      { ts: "101.0", user: "Umaya", text: "hello", threadTs: undefined, botId: undefined },
      { ts: "102.0", user: "Umaya", text: "<@Ubot> look at this", threadTs: undefined, botId: undefined },
    ]);
  });
});

describe("postMessage", () => {
  const account = {
    botToken: "xoxb-good",
    teamId: "T1",
    team: "Acme",
    teamUrl: "https://acme.slack.com/",
    botUserId: "Ubot",
    botId: "B1",
  };

  it("posts into the thread the ask came from", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(JSON.parse(String(init.body))).toEqual({
        channel: "Ceng",
        text: "Cause: redis timeout",
        thread_ts: "101.0",
      });
      return slackOk({ ok: true, ts: "103.0", channel: "Ceng" });
    });

    await expect(
      postMessage(account, { channel: "Ceng", text: "Cause: redis timeout", threadTs: "101.0" }),
    ).resolves.toEqual({ ts: "103.0", channel: "Ceng" });
  });
});
