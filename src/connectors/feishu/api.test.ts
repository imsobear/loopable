import { afterEach, describe, expect, it, vi } from "vitest";

import {
  botInfo,
  history,
  listChats,
  permalink,
  replyMessage,
  sendMessage,
  tenantAccessToken,
} from "./api.ts";

afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

const account = {
  appId: "cli_app",
  appSecret: "secret",
  host: "feishu" as const,
  botOpenId: "ou_bot",
  botName: "Loopable",
  tenantAccessToken: "t-good",
  expiresAt: Date.now() + 60_000,
};

describe("tenantAccessToken", () => {
  it("mints a tenant token from the app id and secret", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
      expect(JSON.parse(String(init.body))).toEqual({ app_id: "cli_app", app_secret: "secret" });
      return ok({ code: 0, tenant_access_token: "t-good", expire: 7200 });
    });

    await expect(tenantAccessToken("feishu", "cli_app", "secret")).resolves.toEqual({
      token: "t-good",
      expiresAt: expect.any(Number),
    });
  });

  it("talks to Lark when the open platform is lark", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal");
      return ok({ code: 0, tenant_access_token: "t-lark", expire: 7200 });
    });

    await expect(tenantAccessToken("lark", "cli_app", "secret")).resolves.toMatchObject({
      token: "t-lark",
    });
  });

  it("says the credentials are wrong when Feishu refuses them", async () => {
    vi.stubGlobal("fetch", async () => ok({ code: 10014, msg: "app secret invalid" }));
    await expect(tenantAccessToken("feishu", "cli_app", "nope")).rejects.toThrow(
      /did not accept those app credentials/,
    );
  });
});

describe("botInfo", () => {
  it("keeps the bot open id and name", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://open.feishu.cn/open-apis/bot/v3/info");
      expect(init.headers).toMatchObject({ Authorization: "Bearer t-good" });
      return ok({
        code: 0,
        bot: { activate_status: 2, app_name: "Loopable", open_id: "ou_bot", avatar_url: "https://img" },
      });
    });

    await expect(botInfo(account)).resolves.toEqual({
      openId: "ou_bot",
      name: "Loopable",
      avatarUrl: "https://img",
    });
  });
});

describe("listChats", () => {
  it("asks for the groups the bot is in", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toContain("https://open.feishu.cn/open-apis/im/v1/chats");
      expect(url).toContain("page_size=100");
      return ok({
        code: 0,
        data: {
          items: [{ chat_id: "oc_eng", name: "eng" }],
          has_more: false,
        },
      });
    });

    await expect(listChats(account)).resolves.toEqual([{ id: "oc_eng", name: "eng" }]);
  });
});

describe("history", () => {
  it("reads messages newer than the cursor, oldest first", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toContain("im/v1/messages");
      expect(url).toContain("container_id=oc_eng");
      expect(url).toContain("container_id_type=chat");
      expect(url).toContain("start_time=1700000000");
      expect(url).toContain("sort_type=ByCreateTimeAsc");
      return ok({
        code: 0,
        data: {
          items: [
            {
              message_id: "om_2",
              create_time: "1700000002000",
              chat_id: "oc_eng",
              msg_type: "text",
              deleted: false,
              sender: { id: "ou_maya", sender_type: "user" },
              body: { content: "{\"text\":\"@_user_1 look\"}" },
              mentions: [{ key: "@_user_1", id: "ou_bot", name: "Loopable" }],
            },
            {
              message_id: "om_1",
              create_time: "1700000001000",
              chat_id: "oc_eng",
              msg_type: "text",
              sender: { id: "ou_maya", sender_type: "user" },
              body: { content: "{\"text\":\"hello\"}" },
            },
          ],
          has_more: false,
        },
      });
    });

    await expect(history(account, "oc_eng", "1700000000000")).resolves.toEqual([
      {
        id: "om_1",
        chatId: "oc_eng",
        createTime: "1700000001000",
        text: "hello",
        senderId: "ou_maya",
        senderType: "user",
        mentionIds: [],
      },
      {
        id: "om_2",
        chatId: "oc_eng",
        createTime: "1700000002000",
        text: "@_user_1 look",
        senderId: "ou_maya",
        senderType: "user",
        mentionIds: ["ou_bot"],
      },
    ]);
  });

  it("says when the app cannot read group messages", async () => {
    vi.stubGlobal("fetch", async () =>
      ok({
        code: 230027,
        msg: "Lack of necessary permissions, ext=need scope: im:message.group_msg",
      }),
    );
    await expect(history(account, "oc_eng", "1700000000000")).rejects.toThrow(/im:message.group_msg/);
  });

  it("skips a group the bot has left", async () => {
    vi.stubGlobal("fetch", async () => ok({ code: 230002, msg: "The bot can not be outside the group." }));
    await expect(history(account, "oc_eng", "1700000000000")).resolves.toEqual([]);
  });
});

describe("replyMessage", () => {
  it("replies to the message that asked", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://open.feishu.cn/open-apis/im/v1/messages/om_1/reply");
      expect(JSON.parse(String(init.body))).toEqual({
        msg_type: "text",
        content: "{\"text\":\"Cause: redis timeout\"}",
      });
      return ok({
        code: 0,
        data: { message_id: "om_2", chat_id: "oc_eng" },
      });
    });

    await expect(replyMessage(account, "om_1", "Cause: redis timeout")).resolves.toEqual({
      id: "om_2",
      chatId: "oc_eng",
    });
  });
});

describe("sendMessage", () => {
  it("posts into a chat when there is no message to reply to", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");
      expect(JSON.parse(String(init.body))).toEqual({
        receive_id: "oc_eng",
        msg_type: "text",
        content: "{\"text\":\"hello\"}",
      });
      return ok({ code: 0, data: { message_id: "om_9", chat_id: "oc_eng" } });
    });

    await expect(sendMessage(account, "oc_eng", "hello")).resolves.toEqual({
      id: "om_9",
      chatId: "oc_eng",
    });
  });
});

describe("permalink", () => {
  it("opens the Feishu chat the bot answered in", () => {
    expect(permalink("feishu", "oc_eng")).toBe(
      "https://applink.feishu.cn/client/chat/open?openChatId=oc_eng",
    );
    expect(permalink("lark", "oc_eng")).toBe(
      "https://applink.larksuite.com/client/chat/open?openChatId=oc_eng",
    );
  });
});
