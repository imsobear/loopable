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
  help: "An absolute path to a checkout on this machine. The agent runs here, so it can read the code you are asking about.",
  placeholder: "/Users/you/code/your-project",
};

/**
 * A bot bound to your account can be messaged by other people, and this
 * workflow runs a coding agent on your machine. Answering only yourself is the
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
  icon: "MessageCircle",
  accent: "bg-emerald-600 text-white",
  auth: {
    kind: "qr_scan",
    note: "Scanning binds a bot to your WeChat account. Loopable can then read what people send that bot and answer as it, and nothing else on your account.",
  },
  workflows: [
    {
      id: "wechat.ask",
      name: "Do what I ask the bot",
      summary: "Runs your agent on your machine when you message the bot, and answers in the chat.",
      trigger: "you send the bot a message",
      // No query to show: messages arrive on a stream rather than being found
      // by asking, so there is nothing here that could be checked.
      writes: "a reply in the chat",
      runsIn: "folder",
      settings: [folder, askers],
      prompt: ASK_PROMPT,
      guidancePlaceholder:
        "Anything the agent should know about this project before it starts. For example: run pnpm test before saying a change works.",
      answer: "text",
      actionId: "wechat.reply",
    },
  ],
  actions: [
    {
      id: "wechat.reply",
      name: "Reply in the chat",
      summary: "Send a message back to whoever asked.",
    },
  ],
  settings: [],
  // One bot per account is the shape of the login; more than one is untested.
  allowsMultipleAccounts: false,
};
