import { randomUUID } from "node:crypto";

import type { JsonValue } from "#/lib/domain.ts";
import type { ConnectorRuntime, QrChallenge, QrOutcome, Signal, WorkItem } from "../types.ts";
import {
  getUpdates,
  isFromPerson,
  notifyStart,
  qrCodeStatus,
  requestQrCode,
  sendMessage,
  textOf,
  WECHAT_API,
  type WechatCredential,
} from "./api.ts";

/**
 * A login code lasted about two minutes when measured against the live API.
 * Told to the page so it can offer a fresh one rather than leave a dead square
 * on screen.
 */
const CODE_LIFETIME_MS = 110_000;

/** What travels to the page and back while a scan is pending. Not secret. */
type Attempt = { qrcode: string; host: string };

function asAttempt(value: JsonValue): Attempt {
  const record = value as Partial<Attempt> | null;
  if (!record || typeof record.qrcode !== "string" || typeof record.host !== "string") {
    throw new Error("This login is no longer valid. Ask for a new code.");
  }
  return { qrcode: record.qrcode, host: record.host };
}

/**
 * What was said, kept because it cannot be asked for again. The token is the
 * part that matters: it is what tells WeChat where a reply goes, and there is
 * no way to look one up for a message that has left the stream.
 */
type Asked = {
  messageId: number;
  fromUserId: string;
  contextToken?: string;
  text: string;
};

function asAsked(value: JsonValue | null): Asked {
  const record = value as Partial<Asked> | null;
  if (!record || typeof record.fromUserId !== "string" || typeof record.text !== "string") {
    throw new Error("This task has lost the message it was about.");
  }
  return {
    messageId: Number(record.messageId ?? 0),
    fromUserId: record.fromUserId,
    contextToken: typeof record.contextToken === "string" ? record.contextToken : undefined,
    text: record.text,
  };
}

/** Enough of the message to recognise it in a list. */
function summarise(text: string): string {
  const line = text.split("\n")[0]!.trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/**
 * WeChat takes a message at a time and long ones are refused, so an answer
 * that runs on is sent in pieces rather than truncated.
 */
const CHUNK = 1500;

function chunked(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > CHUNK) {
    // Prefer a paragraph break, then a line, then wherever we have to.
    const window = rest.slice(0, CHUNK);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    const at = cut > CHUNK / 2 ? cut : CHUNK;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The account, said the way a person would recognise it. */
function accountOf(credential: WechatCredential) {
  return {
    id: credential.botId || credential.userId,
    label: credential.botId ? `WeChat bot ${credential.botId}` : "WeChat bot",
  };
}

export const wechatRuntime: ConnectorRuntime = {
  // Nothing to register and no secret to hold: unlike GitHub, this connector
  // needs no setup before somebody can connect.
  async readiness() {
    return { ready: true };
  },

  /**
   * A stream, not a search: what this returns has already been taken off the
   * server and will not be offered again, which is why every message it keeps
   * carries its whole content rather than a pointer to it.
   */
  async poll({ workflowId, settings, credential, cursor }) {
    if (workflowId !== "wechat.ask") {
      throw new Error(`WeChat cannot watch for ${workflowId}.`);
    }
    const account = credential as WechatCredential;
    const from = typeof cursor === "string" ? cursor : "";
    const { messages, cursor: next } = await getUpdates(account, from);

    // Anyone who can message the bot could otherwise start an agent on this
    // machine, so the default is that only the person who bound it may.
    const onlyMe = (settings.askers ?? "me") !== "anyone";

    const signals: Signal[] = [];
    for (const message of messages) {
      if (!isFromPerson(message)) continue;
      const text = textOf(message);
      if (!text) continue;
      const fromUserId = message.from_user_id ?? "";
      if (onlyMe && fromUserId !== account.userId) continue;

      const asked: Asked = {
        messageId: message.message_id ?? 0,
        fromUserId,
        contextToken: message.context_token,
        text,
      };
      signals.push({
        key: `msg#${asked.messageId}`,
        kind: "message",
        ref: `msg#${asked.messageId}`,
        title: summarise(text),
        // A message in a chat is not somewhere a browser can be sent.
        url: "",
        payload: asked as unknown as JsonValue,
      });
    }
    return { signals, cursor: next };
  },

  async resolveWorkItem({ payload }): Promise<WorkItem> {
    const asked = asAsked(payload);
    return {
      kind: "message",
      ref: `msg#${asked.messageId}`,
      title: summarise(asked.text),
      url: "",
      carry: { toUserId: asked.fromUserId, contextToken: asked.contextToken } as JsonValue,
      context: [
        {
          name: "MESSAGE.md",
          body: [`# What you were asked`, ``, asked.text, ``].join("\n"),
        },
      ],
    };
  },

  async applyAction({ actionId, item, body, credential }) {
    if (actionId !== "wechat.reply") throw new Error(`WeChat cannot ${actionId}.`);
    const account = credential as WechatCredential;
    const carry = (item.carry ?? {}) as { toUserId?: string; contextToken?: string };
    if (!carry.toUserId) throw new Error("There is nobody to reply to on this task.");

    for (const part of chunked(body)) {
      await sendMessage(account, {
        toUserId: carry.toUserId,
        contextToken: carry.contextToken,
        // Unique per piece, so a retry cannot post half an answer twice.
        clientId: randomUUID(),
        text: part,
      });
    }
    // The reply lands in a chat, which has no address to link to.
    return { url: "" };
  },

  auth: {
    async startQrLogin(): Promise<QrChallenge> {
      const code = await requestQrCode();
      return {
        attempt: { qrcode: code.qrcode, host: WECHAT_API },
        encode: code.url,
        expiresInMs: CODE_LIFETIME_MS,
      };
    },

    async pollQrLogin(value: JsonValue): Promise<QrOutcome> {
      const attempt = asAttempt(value);
      const status = await qrCodeStatus(attempt.qrcode, attempt.host);
      switch (status.state) {
        case "confirmed":
          return {
            state: "confirmed",
            result: { credential: status.credential, account: accountOf(status.credential) },
          };
        case "expired":
          return { state: "expired", reason: status.reason };
        case "waiting":
          // The host can move mid-scan, so the attempt is handed back updated
          // rather than assumed to be the one we started with.
          return {
            state: "pending",
            attempt: { qrcode: attempt.qrcode, host: status.host },
            hint: status.hint,
          };
      }
    },

    async identity(credential: unknown) {
      const stored = credential as WechatCredential;
      await notifyStart(stored);
      return { account: accountOf(stored) };
    },
  },
};
