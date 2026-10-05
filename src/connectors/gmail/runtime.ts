import { defineRuntime } from "../define.ts";
import { oauthAppRegistration } from "../oauth-app.ts";
import { getMessage, getProfile, sendMessage } from "./api.ts";
import { composeMail, headerOf, mailContext, mailRef, permalink, summarise } from "./mail.ts";
import { pollGmail, type MailPayload } from "./poll.ts";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  refreshCredential,
  revokeCredential,
  type GmailCredential,
} from "./oauth.ts";

function requireRegistration() {
  const registration = oauthAppRegistration("gmail");
  if (!registration) {
    throw new Error("Gmail is not configured in this build: the OAuth app registration is missing.");
  }
  return registration;
}

/**
 * A usable access token, renewed when the stored one has expired. The renewed
 * credential is handed back so the caller stores it instead of asking Google
 * again on the next call.
 *
 * Google's access tokens last an hour, so unlike GitHub this path is the
 * normal one rather than the exception.
 */
export async function usableToken(
  credential: GmailCredential,
): Promise<{ accessToken: string; refreshed?: GmailCredential }> {
  const stillValid = !credential.expiresAt || Date.now() < credential.expiresAt;
  if (stillValid) return { accessToken: credential.accessToken };
  if (!credential.refreshToken) {
    throw new Error("The Gmail token expired and there is no refresh token. Connect Gmail again.");
  }
  const registration = requireRegistration();
  const refreshed = await refreshCredential({
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    refreshToken: credential.refreshToken,
  });
  return { accessToken: refreshed.accessToken, refreshed };
}

/** The mailbox, as a person would recognise it. */
function accountOf(emailAddress: string) {
  return { id: emailAddress, label: emailAddress };
}

/**
 * Which message this task is about. A task keeps the id, and a pasted link
 * carries one too, so either is enough to fetch the mail again.
 */
function messageIdFrom(url: string, payload: unknown): string {
  const kept = (payload ?? {}) as Partial<MailPayload>;
  if (typeof kept.messageId === "string" && kept.messageId) return kept.messageId;
  const fromUrl = /[#/]([A-Za-z0-9_-]{8,})$/.exec(url.trim());
  if (fromUrl) return fromUrl[1]!;
  throw new Error("This task has lost the message it was about.");
}

export const gmailRuntime = defineRuntime({
  async readiness() {
    if (oauthAppRegistration("gmail")) return { ready: true };
    return {
      ready: false,
      reason: "This build has no Google app registration.",
      fixHint: "Set LOOPABLE_GMAIL_CLIENT_ID and LOOPABLE_GMAIL_CLIENT_SECRET to use your own OAuth app.",
    };
  },

  identifyLink(url) {
    const trimmed = url.trim();
    if (!/^https:\/\/mail\.google\.com\//.test(trimmed)) return null;
    const id = /[#/]([A-Za-z0-9_-]{8,})$/.exec(trimmed);
    return id ? { kind: "email", ref: mailRef(id[1]!) } : null;
  },

  async resolveWorkItem({ url, payload, credential }) {
    const { accessToken } = await usableToken(credential as GmailCredential);
    const message = await getMessage(accessToken, messageIdFrom(url, payload));
    return {
      kind: "email",
      ref: mailRef(message.id),
      title: summarise(message),
      url: permalink(message.id),
      context: [mailContext(message)],
    };
  },

  async poll({ workflowId, settings, credential }) {
    const { accessToken } = await usableToken(credential as GmailCredential);
    // Which mailbox this is, so mail from itself can be told apart.
    const profile = await getProfile(accessToken);
    // No cursor: Gmail is asked what matches now and answers completely.
    return {
      signals: await pollGmail({
        workflowId,
        settings,
        accessToken,
        emailAddress: profile.emailAddress,
      }),
    };
  },

  /**
   * Answers go to the connected account itself, the way a bot answers
   * whoever asked it. When the run started from an email in this inbox, the
   * answer joins that thread.
   */
  async applyAction({ actionId, source, body, credential }) {
    if (actionId !== "gmail.send") throw new Error(`Gmail cannot ${actionId}.`);
    const { accessToken } = await usableToken(credential as GmailCredential);
    const profile = await getProfile(accessToken);

    let subject = source.title || "From Loopable";
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    const sourceId = source.connectorId === "gmail" ? source.ref.replace(/^mail#/, "") : "";
    if (sourceId) {
      const original = await getMessage(accessToken, sourceId);
      threadId = original.threadId;
      inReplyTo = headerOf(original, "Message-ID") || undefined;
      const said = headerOf(original, "Subject");
      if (said) subject = /^re:/i.test(said) ? said : `Re: ${said}`;
    }

    const sent = await sendMessage(
      accessToken,
      composeMail({ to: profile.emailAddress, subject, body, inReplyTo }),
      threadId,
    );
    return { url: permalink(sent.id) };
  },

  auth: {
    async startAuthorization({ redirectUri, state }) {
      const registration = requireRegistration();
      const { verifier, challenge } = createPkce();
      return {
        verifier,
        redirectUrl: buildAuthorizeUrl({
          clientId: registration.clientId,
          redirectUri,
          state,
          challenge,
        }),
      };
    },

    async completeAuthorization({ code, redirectUri, verifier }) {
      const registration = requireRegistration();
      const credential = await exchangeCode({
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
        code,
        redirectUri,
        verifier,
      });
      const profile = await getProfile(credential.accessToken);
      return { credential, account: accountOf(profile.emailAddress) };
    },

    async identity(credential) {
      const { accessToken, refreshed } = await usableToken(credential as GmailCredential);
      const profile = await getProfile(accessToken);
      const account = accountOf(profile.emailAddress);
      return refreshed ? { account, renewedCredential: refreshed } : { account };
    },

    async revoke(credential) {
      await revokeCredential(credential as GmailCredential);
    },
  },
});
