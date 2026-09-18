import { defineManifest } from "../define.ts";
import type { SettingField } from "../types.ts";

const folder: SettingField = {
  key: "folder",
  kind: "text",
  label: "Folder to work in",
  help: "An absolute path to a checkout on this host. The agent runs here, so it can read the code you are asking about.",
  placeholder: "/Users/you/code/your-project",
};

const channel: SettingField = {
  key: "channel",
  kind: "text",
  label: "Channel",
  help: "Leave empty to reply in the thread that asked. Set a channel ID when the work started somewhere else.",
  placeholder: "C0123456789",
};

const ASK_PROMPT = [
  "Someone has sent you a message in Slack. Do what it asks, working in this directory,",
  "and then answer them.",
  "",
  "You are answering into Slack. Be brief: a couple of short paragraphs at most,",
  "no headings, no bullet lists unless you are genuinely listing things. Plain sentences.",
  "",
  "If the message asks a question about this code, read enough of it to answer",
  "properly rather than guessing. If it asks for a change, make the change and",
  "say in one line what you did. If the message is too vague to act on, say what",
  "you need to know instead of assuming.",
].join("\n");

export const slackManifest = defineManifest({
  id: "slack",
  name: "Slack bot",
  tagline: "Paste a bot token from a Slack app — not a Slack login. @mention or DM the bot, and it answers in the thread.",
  docsUrl: "https://api.slack.com/apps",
  icon: "Slack",
  accent: "bg-[#4a154b] text-white",
  auth: {
    kind: "token",
    helpUrl: "https://api.slack.com/apps",
    note: "This is a Slack app in the workspace, not a Slack account sign-in. Create an app at api.slack.com/apps, add bot scopes (channels:history, channels:read, groups:history, groups:read, im:history, im:read, mpim:history, mpim:read, chat:write), Install to Workspace, then paste the Bot User OAuth Token. Invite the bot to any channel it should watch.",
    fields: [
      {
        key: "botToken",
        label: "Bot User OAuth Token",
        placeholder: "xoxb-...",
        secret: true,
      },
    ],
  },
  workflows: [
    {
      id: "slack.ask",
      name: "Do what I ask the bot",
      summary: "Runs your agent when someone @mentions the bot or DMs it, and answers in the thread.",
      trigger: "the bot is @mentioned, or someone DMs it",
      writes: "a reply in the Slack thread",
      runsIn: "folder",
      settings: [folder],
      prompt: ASK_PROMPT,
      guidancePlaceholder:
        "Anything the agent should know about this project before it starts. For example: run pnpm test before saying a change works.",
      answer: "text",
      actionId: "slack.reply",
      pollEveryMs: 60_000,
    },
  ],
  actions: [
    {
      id: "slack.reply",
      name: "Reply in Slack",
      summary: "Post a message back to the thread that asked, or to a channel you name.",
      target: [channel],
      accepts: ["text"],
    },
  ],
  settings: [],
  allowsMultipleAccounts: false,
  byHand: { kind: "none" },
});
