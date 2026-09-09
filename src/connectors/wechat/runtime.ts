import type { JsonValue } from "#/lib/domain.ts";
import type { ConnectorRuntime, QrChallenge, QrOutcome } from "../types.ts";
import {
  notifyStart,
  qrCodeStatus,
  requestQrCode,
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
