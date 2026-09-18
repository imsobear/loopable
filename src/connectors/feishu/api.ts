/**
 * Feishu / Lark Open API, called with a custom app's id and secret.
 * Loopable polls groups the bot is in; Feishu never has to reach this machine.
 */

import { TransientError } from "../errors.ts";

export type FeishuHost = "feishu" | "lark";

export type FeishuCredential = {
  appId: string;
  appSecret: string;
  host: FeishuHost;
  botOpenId: string;
  botName: string;
  avatarUrl?: string;
  tenantAccessToken: string;
  expiresAt: number;
};

export type FeishuChat = {
  id: string;
  name: string;
};

export type FeishuMessage = {
  id: string;
  chatId: string;
  createTime: string;
  text: string;
  senderId?: string;
  senderType?: string;
  mentionIds: string[];
};

type Envelope = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
  bot?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

const API: Record<FeishuHost, string> = {
  feishu: "https://open.feishu.cn/open-apis",
  lark: "https://open.larksuite.com/open-apis",
};

const APPLINK: Record<FeishuHost, string> = {
  feishu: "https://applink.feishu.cn/client/chat/open",
  lark: "https://applink.larksuite.com/client/chat/open",
};

export function parseHost(value: string | undefined): FeishuHost {
  const raw = (value ?? "feishu").trim().toLowerCase();
  if (!raw || raw === "feishu" || raw === "feishu.cn" || raw.includes("feishu.cn")) return "feishu";
  if (raw === "lark" || raw === "larksuite" || raw.includes("larksuite.com") || raw.includes("larkoffice.com")) {
    return "lark";
  }
  throw new Error("Open platform must be feishu (China) or lark (international).");
}

function refuse(code: number | undefined, msg: string | undefined): never {
  if (code === 10003 || code === 10012 || code === 10014) {
    throw new Error("Feishu did not accept those app credentials.");
  }
  throw new Error(msg ? `Feishu refused: ${msg}` : "Feishu refused the request.");
}

async function call(
  host: FeishuHost,
  path: string,
  init: { token?: string; method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<Envelope> {
  const url = new URL(`${API[host]}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url.href, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    throw new TransientError(`Feishu is unreachable: ${(error as Error).message}`);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransientError(`Feishu answered ${response.status}`);
  }
  let body: Envelope;
  try {
    body = (await response.json()) as Envelope;
  } catch {
    throw new Error(`Feishu answered ${response.status}`);
  }
  return body;
}

function dataOf(body: Envelope): Record<string, unknown> {
  if (body.code && body.code !== 0) refuse(body.code, body.msg);
  return body.data ?? {};
}

export async function tenantAccessToken(
  host: FeishuHost,
  appId: string,
  appSecret: string,
): Promise<{ token: string; expiresAt: number }> {
  const body = await call(host, "/auth/v3/tenant_access_token/internal", {
    method: "POST",
    body: { app_id: appId, app_secret: appSecret },
  });
  if (body.code && body.code !== 0) refuse(body.code, body.msg);
  const token = body.tenant_access_token ?? "";
  const expire = typeof body.expire === "number" ? body.expire : 7200;
  if (!token) throw new Error("Feishu did not return a tenant token.");
  return { token, expiresAt: Date.now() + expire * 1000 - 60_000 };
}

export async function botInfo(
  credential: Pick<FeishuCredential, "host" | "tenantAccessToken">,
): Promise<{ openId: string; name: string; avatarUrl?: string }> {
  const body = await call(credential.host, "/bot/v3/info", { token: credential.tenantAccessToken });
  if (body.code && body.code !== 0) refuse(body.code, body.msg);
  const bot = body.bot ?? {};
  const openId = typeof bot.open_id === "string" ? bot.open_id : "";
  const name = typeof bot.app_name === "string" ? bot.app_name : "";
  const avatarUrl = typeof bot.avatar_url === "string" ? bot.avatar_url : undefined;
  if (!openId) throw new Error("Feishu did not return which bot this app is.");
  return { openId, name, ...(avatarUrl ? { avatarUrl } : {}) };
}

export async function listChats(credential: FeishuCredential): Promise<FeishuChat[]> {
  const chats: FeishuChat[] = [];
  let pageToken = "";
  do {
    const query: Record<string, string> = { page_size: "100" };
    if (pageToken) query.page_token = pageToken;
    const body = await call(credential.host, "/im/v1/chats", {
      token: credential.tenantAccessToken,
      query,
    });
    const data = dataOf(body);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const raw of items) {
      const chat = raw as { chat_id?: string; name?: string };
      if (!chat.chat_id) continue;
      chats.push({ id: chat.chat_id, name: chat.name ?? "" });
    }
    pageToken = data.has_more === true && typeof data.page_token === "string" ? data.page_token : "";
  } while (pageToken);
  return chats;
}

function textOf(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : content;
  } catch {
    return content;
  }
}

function mentionsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const mention = entry as { id?: unknown };
      return typeof mention.id === "string" ? mention.id : "";
    })
    .filter(Boolean);
}

export async function history(
  credential: FeishuCredential,
  chatId: string,
  oldestMs?: string,
): Promise<FeishuMessage[]> {
  const parsed: FeishuMessage[] = [];
  let pageToken = "";
  do {
    const query: Record<string, string> = {
      container_id_type: "chat",
      container_id: chatId,
      sort_type: oldestMs ? "ByCreateTimeAsc" : "ByCreateTimeDesc",
      page_size: oldestMs ? "50" : "1",
    };
    if (oldestMs) query.start_time = String(Math.floor(Number(oldestMs) / 1000));
    if (pageToken) query.page_token = pageToken;
    const body = await call(credential.host, "/im/v1/messages", {
      token: credential.tenantAccessToken,
      query,
    });
    if (body.code && body.code !== 0) {
      // Bot left the group, or this kind of chat cannot be read.
      if (body.code === 230002 || body.code === 231203) return parsed;
      refuse(body.code, body.msg);
    }
    const data = body.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    for (const raw of items) {
      const message = raw as {
        message_id?: string;
        chat_id?: string;
        create_time?: string;
        msg_type?: string;
        deleted?: boolean;
        sender?: { id?: string; sender_type?: string };
        body?: { content?: string };
        mentions?: unknown;
      };
      if (!message.message_id || message.deleted) continue;
      parsed.push({
        id: message.message_id,
        chatId: message.chat_id ?? chatId,
        createTime: message.create_time ?? "",
        text: textOf(message.body?.content),
        ...(message.sender?.id ? { senderId: message.sender.id } : {}),
        ...(message.sender?.sender_type ? { senderType: message.sender.sender_type } : {}),
        mentionIds: mentionsOf(message.mentions),
      });
    }
    pageToken =
      oldestMs && data.has_more === true && typeof data.page_token === "string" ? data.page_token : "";
  } while (pageToken);
  return parsed.sort((a, b) => Number(a.createTime) - Number(b.createTime));
}

export async function replyMessage(
  credential: FeishuCredential,
  messageId: string,
  text: string,
): Promise<{ id: string; chatId: string }> {
  const body = await call(credential.host, `/im/v1/messages/${messageId}/reply`, {
    token: credential.tenantAccessToken,
    method: "POST",
    body: { msg_type: "text", content: JSON.stringify({ text }) },
  });
  const data = dataOf(body);
  const id = typeof data.message_id === "string" ? data.message_id : "";
  const chatId = typeof data.chat_id === "string" ? data.chat_id : "";
  if (!id) throw new Error("Feishu accepted the reply but did not say where it landed.");
  return { id, chatId };
}

export async function sendMessage(
  credential: FeishuCredential,
  chatId: string,
  text: string,
): Promise<{ id: string; chatId: string }> {
  const body = await call(credential.host, "/im/v1/messages", {
    token: credential.tenantAccessToken,
    method: "POST",
    query: { receive_id_type: "chat_id" },
    body: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
  });
  const data = dataOf(body);
  const id = typeof data.message_id === "string" ? data.message_id : "";
  const landed = typeof data.chat_id === "string" ? data.chat_id : chatId;
  if (!id) throw new Error("Feishu accepted the message but did not say where it landed.");
  return { id, chatId: landed };
}

export function permalink(host: FeishuHost, chatId: string): string {
  return `${APPLINK[host]}?openChatId=${chatId}`;
}
