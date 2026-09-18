import { defineManifest } from "../define.ts";
import type { SettingField } from "../types.ts";

const folder: SettingField = {
  key: "folder",
  kind: "text",
  label: "Folder to work in",
  help: "An absolute path to a checkout on this host. The agent runs here, so it can read the code you are asking about.",
  placeholder: "/Users/you/code/your-project",
};

const chat: SettingField = {
  key: "chat",
  kind: "text",
  label: "Chat ID",
  help: "Leave empty to reply to the message that asked. Set a chat ID (oc_…) when the work started somewhere else.",
  placeholder: "oc_...",
};

const ASK_PROMPT = [
  "Someone has sent you a message in Feishu. Do what it asks, working in this directory,",
  "and then answer them.",
  "",
  "You are answering into Feishu. Be brief: a couple of short paragraphs at most,",
  "no headings, no bullet lists unless you are genuinely listing things. Plain sentences.",
  "",
  "If the message asks a question about this code, read enough of it to answer",
  "properly rather than guessing. If it asks for a change, make the change and",
  "say in one line what you did. If the message is too vague to act on, say what",
  "you need to know instead of assuming.",
].join("\n");

export const feishuManifest = defineManifest({
  id: "feishu",
  name: "Feishu / Lark bot",
  tagline:
    "Paste App ID and App Secret from a Feishu or Lark app — not a Feishu login. @mention the bot in a group, and it answers in the thread.",
  docsUrl: "https://open.feishu.cn/app",
  icon: "Feishu",
  accent: "bg-[#3370ff] text-white",
  auth: {
    kind: "token",
    helpUrl: "https://open.feishu.cn/app",
    note: "This is a custom Feishu or Lark app, not a Feishu account sign-in. Create an app, enable Bot, add permissions (im:chat:readonly, im:message, im:message.group_msg, im:message:send_as_bot), create a version and publish it, then paste App ID and App Secret. Invite the bot to any group it should watch. Put lark in Open platform for Lark (international).",
    fields: [
      {
        key: "appId",
        label: "App ID",
        placeholder: "cli_...",
        secret: false,
      },
      {
        key: "appSecret",
        label: "App Secret",
        placeholder: "App Secret",
        secret: true,
      },
      {
        key: "host",
        label: "Open platform",
        placeholder: "feishu or lark",
        secret: false,
        optional: true,
      },
    ],
  },
  workflows: [
    {
      id: "feishu.ask",
      name: "Do what I ask the bot",
      summary:
        "Runs your agent when someone @mentions the bot in a group it is in, and answers in the thread.",
      trigger: "the bot is @mentioned in a group it is in",
      writes: "a reply in the Feishu thread",
      runsIn: "folder",
      settings: [folder],
      prompt: ASK_PROMPT,
      guidancePlaceholder:
        "Anything the agent should know about this project before it starts. For example: run pnpm test before saying a change works.",
      answer: "text",
      actionId: "feishu.reply",
      pollEveryMs: 60_000,
    },
  ],
  actions: [
    {
      id: "feishu.reply",
      name: "Reply in Feishu",
      summary: "Post a message back to the thread that asked, or to a chat you name.",
      target: [chat],
      accepts: ["text"],
    },
  ],
  settings: [],
  allowsMultipleAccounts: false,
  byHand: { kind: "none" },
});
