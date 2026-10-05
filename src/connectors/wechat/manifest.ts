import type { ConnectorManifest, SettingField } from "../types.ts";

/**
 * Where the agent runs. Asking a phone "what broke the build" is only worth
 * anything if the agent can read the build, so this workflow works in a real
 * checkout rather than an empty directory.
 */
const folder: SettingField = {
  key: "folder",
  kind: "text",
  label: "Folder to work in",
  help: "Absolute path to a checkout on the runner. The agent works here.",
  placeholder: "/Users/you/code/your-project",
};

/**
 * A bot bound to your account can be messaged by other people, and this
 * workflow runs a coding agent on a runner. Answering only yourself is the
 * default because the alternative hands strangers your terminal.
 */
const askers: SettingField = {
  key: "askers",
  kind: "select",
  label: "Who can ask",
  options: [
    { value: "me", label: "Only me" },
    { value: "anyone", label: "Anyone who messages the bot" },
  ],
  default: "me",
};

/**
 * Whoever asked is the answer for a loop that a message started, and the only
 * case WeChat handles properly: the reply carries the token off the message it
 * is answering. A loop triggered somewhere else has no message behind it and
 * so no token, which the help says plainly rather than letting someone find
 * out from a notification that never arrives.
 */
const recipient: SettingField = {
  key: "to",
  kind: "select",
  label: "Who to send it to",
  help: "\"Me\" only arrives if you messaged the bot in the last half day.",
  options: [
    { value: "source", label: "Whoever asked" },
    { value: "me", label: "Me" },
  ],
  default: "source",
};

const ASK_PROMPT = [
  "Someone has sent you a message. Do what it asks, working in this directory,",
  "and then answer them.",
  "",
  "You are answering into a chat on a phone. Be brief: a couple of short",
  "paragraphs at most, no headings, no bullet lists unless you are genuinely",
  "listing things. Plain sentences.",
  "",
  "If the message asks a question about this code, read enough of it to answer",
  "properly rather than guessing. If it asks for a change, make the change and",
  "say in one line what you did. If the message is too vague to act on, say what",
  "you need to know instead of assuming.",
].join("\n");

/**
 * WeChat, through Tencent's iLink bot API.
 *
 * Loopable speaks that API directly rather than running Tencent's OpenClaw
 * plugin, so nothing else has to be installed and nothing else is listening to
 * the same account. Tencent documents the protocol for exactly this and leaves
 * a field for clients to name themselves in, which is what we fill in.
 *
 */
export const wechatManifest: ConnectorManifest = {
  id: "wechat",
  name: "WeChat",
  tagline: "Bind a bot to your WeChat by scanning a code.",
  docsUrl: "https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md",
  icon: "Wechat",
  accent: "bg-[#07c160] text-white",
  auth: {
    kind: "qr_scan",
    note: "Scanning binds a bot to your WeChat account. Loopable can then read what people send that bot and answer as it, and nothing else on your account.",
  },
  triggers: [
    {
      id: "wechat.ask",
      when: "The WeChat bot gets a message",
      trigger: "someone sends the WeChat bot a message",
      // No query to show: messages arrive on a stream rather than being found
      // by asking, so there is nothing here that could be checked.
      runsIn: "folder",
      settings: [folder, askers],
      guidancePlaceholder:
        "Anything the agent should know about this project before it starts. For example: run pnpm test before saying a change works.",
      answer: "text",
      actionId: "wechat.reply",
    },
  ],
  workflows: [
    {
      id: "wechat.ask",
      name: "Do what I ask the WeChat bot",
      summary: "Runs the agent when someone messages the WeChat bot, and answers in the chat.",
      triggerId: "wechat.ask",
      prompt: ASK_PROMPT,
    },
  ],
  actions: [
    {
      id: "wechat.reply",
      name: "Reply in the chat",
      summary: "Send a message back to whoever asked.",
      target: [recipient],
      // A chat message is text. A review sent here reads as prose, with the
      // file and line of each point written out.
      accepts: ["text"],
    },
  ],
  settings: [],
  // One bot per account is the shape of the login; more than one is untested.
  allowsMultipleAccounts: false,
  // A message is handed over once and is gone from the stream, so there is
  // no address to paste and no way to ask for one again.
  byHand: { kind: "none" },
};
