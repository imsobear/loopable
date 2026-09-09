/**
 * Tencent's iLink bot API, as documented for clients that are not OpenClaw:
 * https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md
 *
 * The document describes what Tencent's own client does rather than promising
 * a server contract, so anything not observed here is treated as optional and
 * a surprise is reported rather than assumed away.
 */

import { TransientError } from "../errors.ts";

export const WECHAT_API = "https://ilinkai.weixin.qq.com";

/**
 * The version of the protocol we speak, not of Loopable. It is the plugin
 * release whose documented behaviour this client was written against, encoded
 * as 0x00MMNNPP and sent as decimal.
 */
const PROTOCOL = { major: 2, minor: 4, patch: 8 };
const CLIENT_VERSION = String((PROTOCOL.major << 16) | (PROTOCOL.minor << 8) | PROTOCOL.patch);

/**
 * Who is calling, in the slot Tencent left for clients other than their own.
 * Sent for their observability, not for auth, and worth being honest in.
 */
const BASE_INFO = {
  channel_version: `${PROTOCOL.major}.${PROTOCOL.minor}.${PROTOCOL.patch}`,
  bot_agent: "Loopable/0.1",
};

/** What a completed scan leaves us holding. */
export type WechatCredential = {
  botToken: string;
  botId: string;
  userId: string;
  /** Where this account's requests go, which the login may move. */
  baseUrl: string;
};

const APP_HEADERS = { "iLink-App-Id": "bot", "iLink-App-ClientVersion": CLIENT_VERSION };

/** "Base64-encoded decimal representation of a random uint32." */
function uin(): string {
  return Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString("base64");
}

function postHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": uin(),
    ...APP_HEADERS,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * WeChat's own trouble is not ours to fail a loop over. A refused request is
 * an answer; an unreachable host or a 5xx is a bad minute.
 */
async function call<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new TransientError(`WeChat is unreachable: ${(error as Error).message}`);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransientError(`WeChat answered ${response.status}`);
  }
  if (!response.ok) throw new Error(`WeChat answered ${response.status}`);
  return (await response.json()) as T;
}

export type QrCode = { qrcode: string; url: string };

export async function requestQrCode(): Promise<QrCode> {
  const body = await call<{ qrcode?: string; qrcode_img_content?: string; ret?: number }>(
    `${WECHAT_API}/ilink/bot/get_bot_qrcode?bot_type=3`,
    {
      method: "POST",
      headers: postHeaders(),
      // Tokens we already hold could go here; a fresh login needs none.
      body: JSON.stringify({ local_token_list: [] }),
    },
  );
  if (!body.qrcode || !body.qrcode_img_content) {
    throw new Error("WeChat did not return a login code.");
  }
  return { qrcode: body.qrcode, url: body.qrcode_img_content };
}

export type QrStatus =
  | { state: "waiting"; host: string; hint?: string }
  | { state: "expired"; reason?: string }
  | { state: "confirmed"; credential: WechatCredential };

type StatusBody = {
  status?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
};

function absolute(host: string): string {
  return host.startsWith("http") ? host : `https://${host}`;
}

/**
 * One look at a pending scan. Everything except a finished login is a reason
 * to look again, including a failed request: a login in progress should not be
 * thrown away over one bad response.
 */
export async function qrCodeStatus(qrcode: string, host: string): Promise<QrStatus> {
  let body: StatusBody;
  try {
    body = await call<StatusBody>(
      `${absolute(host)}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { headers: APP_HEADERS },
    );
  } catch {
    return { state: "waiting", host };
  }

  switch (body.status) {
    case "confirmed":
      if (!body.bot_token) return { state: "expired", reason: "WeChat confirmed without a token." };
      return {
        state: "confirmed",
        credential: {
          botToken: body.bot_token,
          botId: body.ilink_bot_id ?? "",
          userId: body.ilink_user_id ?? "",
          baseUrl: body.baseurl ? absolute(body.baseurl) : WECHAT_API,
        },
      };
    case "scaned":
      return { state: "waiting", host, hint: "Scanned. Confirm it on your phone." };
    case "scaned_but_redirect":
      return {
        state: "waiting",
        host: body.redirect_host ? absolute(body.redirect_host) : host,
        hint: "Scanned. Confirm it on your phone.",
      };
    case "need_verifycode":
      // The code is shown on the phone and typed into WeChat, not into us.
      return { state: "waiting", host, hint: "WeChat is asking for a verification code." };
    case "binded_redirect":
      return { state: "expired", reason: "This account is already bound somewhere else." };
    case "verify_code_blocked":
      return { state: "expired", reason: "Too many verification attempts. Start again." };
    case "expired":
      return { state: "expired" };
    default:
      return { state: "waiting", host };
  }
}

type Answer = { ret?: number; errcode?: number; errmsg?: string };

/** A dead token, as opposed to a request WeChat merely disliked. */
const SESSION_GONE = -14;

/**
 * Whether WeChat refused, and why.
 *
 * It reports trouble in two fields and not always the same one: a call with a
 * dead token comes back `{errcode:-14}` with no `ret` at all, so a check that
 * reads only `ret` would call that a success and let a signed-out account look
 * connected.
 */
function signedOut(body: Answer): boolean {
  return body.ret === SESSION_GONE || body.errcode === SESSION_GONE;
}

function refusal(body: Answer): string | null {
  const codes = [body.ret, body.errcode].filter((code): code is number => typeof code === "number");
  const bad = codes.find((code) => code !== 0);
  if (bad === undefined) return null;
  if (bad === SESSION_GONE) {
    return "WeChat has signed this bot out. Connect again by scanning.";
  }
  return body.errmsg || `WeChat refused the request (${bad}).`;
}

/**
 * Tells WeChat a client is up, and doubles as the proof that a stored token
 * still works: it needs nothing but the token, and a dead one is refused.
 *
 * Reading the account's config would be the obvious check and is the wrong
 * one. It mints a typing ticket, which needs a conversation, so it fails on
 * exactly the account that has just been connected and never messaged.
 */
export async function notifyStart(credential: WechatCredential): Promise<void> {
  const body = await call<Answer>(`${credential.baseUrl}/ilink/bot/msg/notifystart`, {
    method: "POST",
    headers: postHeaders(credential.botToken),
    body: JSON.stringify({ base_info: BASE_INFO }),
  });
  const refused = refusal(body);
  if (refused) throw new Error(refused);
}

/** `1` is a person typing at us. `2` is the bot, which is to say ourselves. */
const FROM_USER = 1;
const TEXT_ITEM = 1;

type MessageItem = { type?: number; text_item?: { text?: string } };

export type WeixinMessage = {
  message_id?: number;
  from_user_id?: string;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  item_list?: MessageItem[];
  /** Says which conversation a reply belongs to. Expires; see `sendMessage`. */
  context_token?: string;
  create_time_ms?: number;
};

/** What someone actually typed, with the parts we cannot read left out. */
export function textOf(message: WeixinMessage): string {
  return (message.item_list ?? [])
    .filter((item) => item.type === TEXT_ITEM)
    .map((item) => item.text_item?.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n")
    .trim();
}

export function isFromPerson(message: WeixinMessage): boolean {
  return message.message_type === FROM_USER;
}

/**
 * How long to hold the connection open waiting for someone to type. This is a
 * long poll and the server decides when to answer, so the limit is ours: the
 * caller is a loop with other loops to get to, and an empty answer costs it a
 * turn rather than the whole minute.
 */
const WAIT_MS = 10_000;

/**
 * Messages since the last call, and the cursor to hand back on the next one.
 *
 * Unlike everything else Loopable polls, this is a stream: what it returns, it
 * will not return again. Nothing is lost by giving up on a slow request, since
 * the cursor only moves when an answer arrives, but an answer that is thrown
 * away takes its messages with it.
 */
export async function getUpdates(
  credential: WechatCredential,
  cursor: string,
): Promise<{ messages: WeixinMessage[]; cursor: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), WAIT_MS);
  let body: Answer & { msgs?: WeixinMessage[]; get_updates_buf?: string };
  try {
    body = await call(`${credential.baseUrl}/ilink/bot/getupdates`, {
      method: "POST",
      headers: postHeaders(credential.botToken),
      body: JSON.stringify({ get_updates_buf: cursor, base_info: BASE_INFO }),
      signal: abort.signal,
    });
  } catch (error) {
    // Our own deadline, not WeChat's problem: nobody typed in time.
    if (abort.signal.aborted) return { messages: [], cursor };
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const refused = refusal(body);
  if (refused) throw new Error(refused);
  return { messages: body.msgs ?? [], cursor: body.get_updates_buf || cursor };
}

/**
 * Replies to whoever sent `contextToken`.
 *
 * The token comes off the message being answered and cannot be invented: it is
 * what tells WeChat which conversation this belongs to, and it goes stale
 * after a couple of days, which is why a reply is worth queueing but not worth
 * retrying for a week. `clientId` is what stops a retry saying it twice.
 */
export async function sendMessage(
  credential: WechatCredential,
  input: { toUserId: string; contextToken?: string; clientId: string; text: string },
): Promise<void> {
  const body = await call<Answer>(`${credential.baseUrl}/ilink/bot/sendmessage`, {
    method: "POST",
    headers: postHeaders(credential.botToken),
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: input.toUserId,
        client_id: input.clientId,
        message_type: 2,
        message_state: 2,
        ...(input.contextToken ? { context_token: input.contextToken } : {}),
        item_list: [{ type: TEXT_ITEM, text_item: { text: input.text } }],
      },
      base_info: BASE_INFO,
    }),
  });
  const refused = refusal(body);
  if (!refused) return;
  // A message with no token is one nobody asked for, and WeChat carries those
  // only for about half a day after the person last wrote to the bot. What it
  // says once that has run out is "prepare failed", which reads like a fault
  // in this program rather than the one thing that would fix it.
  if (!input.contextToken && !signedOut(body)) {
    throw new Error(
      `WeChat would not take a message nobody asked for (it said: ${refused}). ` +
        "It only delivers those for about half a day after you last write to the bot, " +
        "so send the bot anything and this will go through.",
    );
  }
  throw new Error(refused);
}
