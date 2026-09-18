import type { JsonValue } from "#/lib/domain.ts";
import type { ActionSource, ConnectorRuntime, Signal, WorkItem } from "../types.ts";
import {
  botInfo,
  history,
  listChats,
  parseHost,
  permalink,
  replyMessage,
  sendMessage,
  tenantAccessToken,
  type FeishuCredential,
} from "./api.ts";

type Asked = {
  chatId: string;
  messageId: string;
  user?: string;
  text: string;
};

function asAsked(value: JsonValue | null): Asked {
  const record = value as Partial<Asked> | null;
  if (!record || typeof record.chatId !== "string" || typeof record.messageId !== "string") {
    throw new Error("This task has lost the message it was about.");
  }
  return {
    chatId: record.chatId,
    messageId: record.messageId,
    user: typeof record.user === "string" ? record.user : undefined,
    text: typeof record.text === "string" ? record.text : "",
  };
}

function asCursor(value: JsonValue | null): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function summarise(text: string): string {
  const line = text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
  if (!line) return "Feishu message";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function isAsk(input: {
  senderId?: string;
  senderType?: string;
  mentionIds: string[];
  botOpenId: string;
}): boolean {
  if (input.senderType === "app" || input.senderId === input.botOpenId) return false;
  return input.mentionIds.includes(input.botOpenId);
}

function destination(
  target: Record<string, unknown>,
  source: ActionSource,
): { chatId?: string; messageId?: string } {
  if (typeof target.chat === "string" && target.chat.trim()) {
    return { chatId: target.chat.trim() };
  }
  if (source.connectorId !== "feishu") {
    throw new Error("There is no Feishu chat behind this task. Choose one on the loop.");
  }
  const carry = (source.carry ?? {}) as { chatId?: string; messageId?: string };
  if (!carry.chatId && !carry.messageId) {
    throw new Error("There is no Feishu chat behind this task. Choose one on the loop.");
  }
  return { chatId: carry.chatId, messageId: carry.messageId };
}

function accountOf(credential: FeishuCredential) {
  return {
    id: credential.botOpenId,
    label: credential.botName || credential.appId,
    ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}),
  };
}

/**
 * Tenant tokens last two hours. Minting on every poll would trip Feishu's
 * rate limit, so a still-valid one is reused and a fresh one is stored.
 */
async function usable(credential: FeishuCredential): Promise<{
  credential: FeishuCredential;
  refreshed?: FeishuCredential;
}> {
  if (Date.now() < credential.expiresAt) return { credential };
  const minted = await tenantAccessToken(credential.host, credential.appId, credential.appSecret);
  const refreshed: FeishuCredential = {
    ...credential,
    tenantAccessToken: minted.token,
    expiresAt: minted.expiresAt,
  };
  return { credential: refreshed, refreshed };
}

export const feishuRuntime: ConnectorRuntime = {
  async readiness() {
    return { ready: true };
  },

  async poll({ workflowId, credential, cursor }) {
    if (workflowId !== "feishu.ask") {
      throw new Error(`Feishu cannot watch for ${workflowId}.`);
    }
    const { credential: account } = await usable(credential as FeishuCredential);
    const previous = asCursor(cursor);
    const chats = await listChats(account);
    const next: Record<string, string> = { ...previous };
    const signals: Signal[] = [];

    for (const chat of chats) {
      const oldest = previous[chat.id];
      const messages = await history(account, chat.id, oldest);
      if (messages.length === 0) {
        if (!next[chat.id]) next[chat.id] = String(Date.now());
        continue;
      }
      next[chat.id] = messages[messages.length - 1]!.createTime;
      if (!oldest) continue;
      for (const message of messages) {
        if (oldest && Number(message.createTime) <= Number(oldest)) continue;
        if (
          !isAsk({
            senderId: message.senderId,
            senderType: message.senderType,
            mentionIds: message.mentionIds,
            botOpenId: account.botOpenId,
          })
        ) {
          continue;
        }
        const asked: Asked = {
          chatId: message.chatId,
          messageId: message.id,
          user: message.senderId,
          text: message.text,
        };
        signals.push({
          key: `${message.chatId}:${message.id}`,
          kind: "message",
          ref: message.id,
          title: summarise(message.text),
          url: permalink(account.host, message.chatId),
          payload: asked as unknown as JsonValue,
        });
      }
    }

    return { signals, cursor: next };
  },

  async resolveWorkItem({ payload }): Promise<WorkItem> {
    const asked = asAsked(payload);
    return {
      kind: "message",
      ref: asked.messageId,
      title: summarise(asked.text),
      url: "",
      carry: { chatId: asked.chatId, messageId: asked.messageId } as JsonValue,
      context: [
        {
          name: "MESSAGE.md",
          body: [`# What you were asked`, ``, asked.text, ``].join("\n"),
        },
      ],
    };
  },

  async applyAction({ actionId, target, source, body, credential }) {
    if (actionId !== "feishu.reply") throw new Error(`Feishu cannot ${actionId}.`);
    const { credential: account } = await usable(credential as FeishuCredential);
    const to = destination(target, source);
    const text = body.trim();
    const posted =
      to.messageId && source.connectorId === "feishu"
        ? await replyMessage(account, to.messageId, text)
        : await sendMessage(account, to.chatId ?? "", text);
    return { url: permalink(account.host, posted.chatId || to.chatId || "") };
  },

  auth: {
    async connectWithFields(fields) {
      const appId = fields.appId?.trim() ?? "";
      const appSecret = fields.appSecret?.trim() ?? "";
      if (!appId) throw new Error("Paste the App ID from your Feishu or Lark app.");
      if (!appSecret) throw new Error("Paste the App Secret from your Feishu or Lark app.");
      const host = parseHost(fields.host);
      const minted = await tenantAccessToken(host, appId, appSecret);
      const bot = await botInfo({ host, tenantAccessToken: minted.token });
      const stored: FeishuCredential = {
        appId,
        appSecret,
        host,
        botOpenId: bot.openId,
        botName: bot.name,
        ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}),
        tenantAccessToken: minted.token,
        expiresAt: minted.expiresAt,
      };
      return { credential: stored, account: accountOf(stored) };
    },

    async identity(credential: unknown) {
      const stored = credential as FeishuCredential;
      const { credential: fresh, refreshed } = await usable(stored);
      const bot = await botInfo(fresh);
      const updated: FeishuCredential = {
        ...fresh,
        botOpenId: bot.openId,
        botName: bot.name,
        ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}),
      };
      return {
        account: accountOf(updated),
        ...(refreshed ? { renewedCredential: updated } : {}),
      };
    },
  },
};
