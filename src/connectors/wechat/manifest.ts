import type { ConnectorManifest } from "../types.ts";

/**
 * WeChat, through Tencent's iLink bot API.
 *
 * Loopable speaks that API directly rather than running Tencent's OpenClaw
 * plugin, so nothing else has to be installed and nothing else is listening to
 * the same account. Tencent documents the protocol for exactly this and leaves
 * a field for clients to name themselves in, which is what we fill in.
 *
 * No workflows yet. Binding an account is worth having on its own, and what a
 * rule should do with a message is a question better answered after watching
 * real ones arrive than before.
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
  workflows: [],
  actions: [],
  settings: [],
  // One bot per account is the shape of the login; more than one is untested.
  allowsMultipleAccounts: false,
};
