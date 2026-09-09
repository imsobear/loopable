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
 * WeChat's own trouble is not ours to fail a rule over. A refused request is
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

/**
 * Reads the account's configuration, which is the cheapest thing that proves a
 * stored token is still good without sending anybody a message.
 */
export async function getConfig(credential: WechatCredential): Promise<void> {
  const body = await call<{ ret?: number; errmsg?: string }>(
    `${credential.baseUrl}/ilink/bot/getconfig`,
    {
      method: "POST",
      headers: postHeaders(credential.botToken),
      body: JSON.stringify({ ilink_user_id: credential.userId, base_info: BASE_INFO }),
    },
  );
  if (body.ret !== undefined && body.ret !== 0) {
    throw new Error(body.errmsg || `WeChat rejected the stored login (ret ${body.ret}).`);
  }
}
