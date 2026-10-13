import type { JsonValue } from "#/lib/domain.ts";
import { isTransient } from "../errors.ts";
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
  threadHistory,
  threadOf,
  type FeishuCredential,
  type FeishuMessage,
} from "./api.ts";

/** What was said in the thread before the bot was asked, oldest first. */
type Said = { by: "bot" | "person"; text: string };

type Asked = {
  chatId: string;
  messageId: string;
  user?: string;
  text: string;
  earlier?: Said[];
};

/**
 * A thread the bot answers in, and how far into it this loop has read. Until
 * the first answer is posted there is no thread yet, only the message it will
 * hang from.
 */
type Watch = { chatId: string; messageId: string; threadId?: string; last: string };

/** A thread nobody has written in for this long is no longer read. */
const WATCH_MS = 7 * 24 * 60 * 60 * 1000;
/** An ask that never got a thread was answered somewhere else, or not at all. */
const PENDING_MS = 24 * 60 * 60 * 1000;
/** Every thread costs a request on every look, so only the liveliest are kept. */
const WATCH_LIMIT = 50;
const EARLIER_LIMIT = 20;
const SAID_LIMIT = 2000;

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
    ...(Array.isArray(record.earlier) ? { earlier: record.earlier } : {}),
  };
}

function asWatches(value: JsonValue | null): Record<string, Watch> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value.threads : null;
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const out: Record<string, Watch> = {};
  for (const [key, entry] of Object.entries(record)) {
    const watch = entry as Partial<Watch> | null;
    if (!watch || typeof watch.chatId !== "string" || typeof watch.messageId !== "string") continue;
    if (typeof watch.last !== "string") continue;
    out[key] = {
      chatId: watch.chatId,
      messageId: watch.messageId,
      last: watch.last,
      ...(typeof watch.threadId === "string" ? { threadId: watch.threadId } : {}),
    };
  }
  return out;
}

/** Chats by id to the newest message read in each. Threads are kept apart. */
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

function signalFor(account: FeishuCredential, message: FeishuMessage, earlier?: Said[]): Signal {
  const asked: Asked = {
    chatId: message.chatId,
    messageId: message.id,
    user: message.senderId,
    text: message.text,
    ...(earlier?.length ? { earlier } : {}),
  };
  return {
    key: `${message.chatId}:${message.id}`,
    kind: "message",
    ref: message.id,
    title: summarise(message.text),
    url: permalink(account.host, message.chatId),
    payload: asked as unknown as JsonValue,
    at: Number(message.createTime),
  };
}

function saidBy(account: FeishuCredential, message: FeishuMessage): Said {
  const bot = message.senderType === "app" || message.senderId === account.botOpenId;
  const text = message.text.length > SAID_LIMIT ? `${message.text.slice(0, SAID_LIMIT - 1)}…` : message.text;
  return { by: bot ? "bot" : "person", text };
}

function asksIn(account: FeishuCredential, messages: FeishuMessage[], after: string): FeishuMessage[] {
  return messages.filter(
    (message) =>
      Number(message.createTime) > Number(after) &&
      isAsk({
        senderId: message.senderId,
        senderType: message.senderType,
        mentionIds: message.mentionIds,
        botOpenId: account.botOpenId,
      }),
  );
}

/**
 * Reads the threads the bot answers in, for the mentions an ordinary group's
 * history leaves out. Returns the threads still worth reading.
 */
async function readThreads(
  account: FeishuCredential,
  watches: Record<string, Watch>,
  signals: Signal[],
): Promise<Record<string, Watch>> {
  const now = Date.now();
  const kept: Record<string, Watch> = {};
  for (const watch of Object.values(watches)) {
    const idle = now - Number(watch.last);
    if (idle > WATCH_MS || (!watch.threadId && idle > PENDING_MS)) continue;
    try {
      const threadId = watch.threadId ?? (await threadOf(account, watch.messageId));
      if (!threadId) {
        kept[watch.messageId] = watch;
        continue;
      }
      const thread = { threadId, chatId: watch.chatId };
      const messages = await threadHistory(account, thread, watch.last);
      const asks = asksIn(account, messages, watch.last);
      // Someone asking in a thread is carrying on a conversation, so the agent
      // gets what came before it. Read once, only when there is an ask.
      const whole = asks.length > 0 ? await threadHistory(account, thread, "0") : [];
      for (const ask of asks) {
        const before = whole.filter((message) => Number(message.createTime) < Number(ask.createTime));
        signals.push(
          signalFor(
            account,
            ask,
            before.slice(-EARLIER_LIMIT).map((message) => saidBy(account, message)),
          ),
        );
      }
      const newest = messages.reduce(
        (latest, message) => (Number(message.createTime) > Number(latest) ? message.createTime : latest),
        watch.last,
      );
      const existing = kept[threadId];
      kept[threadId] = {
        ...watch,
        threadId,
        last: existing && Number(existing.last) > Number(newest) ? existing.last : newest,
      };
    } catch (error) {
      if (isTransient(error)) throw error;
      // Deleted, or the bot was taken out of the group: nothing left to read.
    }
  }
  return kept;
}

function newest(watches: Record<string, Watch>): Record<string, Watch> {
  const entries = Object.entries(watches).sort(([, a], [, b]) => Number(b.last) - Number(a.last));
  return Object.fromEntries(entries.slice(0, WATCH_LIMIT));
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

  async poll({ workflowId, credential, cursor, since }) {
    if (workflowId !== "feishu.ask") {
      throw new Error(`Feishu cannot watch for ${workflowId}.`);
    }
    const { credential: account } = await usable(credential as FeishuCredential);
    const previous = asCursor(cursor);
    const chats = await listChats(account);
    const next: Record<string, string> = { ...previous };
    const signals: Signal[] = [];
    // Answers go in threads, and a group's history does not show what is
    // said in them, so the threads are read on their own.
    const watches = await readThreads(account, asWatches(cursor), signals);

    for (const chat of chats) {
      // A group seen for the first time is read from when the loop last
      // looked, so a mention sent before this look is not taken as the start.
      const oldest = previous[chat.id] ?? String(since);
      const messages = await history(account, chat.id, oldest);
      if (messages.length === 0) {
        next[chat.id] = oldest;
        continue;
      }
      next[chat.id] = messages[messages.length - 1]!.createTime;
      for (const message of asksIn(account, messages, oldest)) {
        signals.push(signalFor(account, message));
        // The answer will open a thread under it, which is read from here on.
        const key = message.threadId ?? message.id;
        if (watches[key]) continue;
        watches[key] = {
          chatId: message.chatId,
          messageId: message.id,
          last: message.createTime,
          ...(message.threadId ? { threadId: message.threadId } : {}),
        };
      }
    }

    return { signals, cursor: { ...next, threads: newest(watches) } as unknown as JsonValue };
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
          body: [
            ...(asked.earlier?.length
              ? [
                  `# Earlier in this thread`,
                  ``,
                  ...asked.earlier.flatMap((said) => [
                    `**${said.by === "bot" ? "You" : "Them"}:** ${said.text}`,
                    ``,
                  ]),
                ]
              : []),
            `# What you were asked`,
            ``,
            asked.text,
            ``,
          ].join("\n"),
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
