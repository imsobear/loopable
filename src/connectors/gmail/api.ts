import { TransientError } from "../errors.ts";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function request<T>(accessToken: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch (error) {
    throw new TransientError(
      `Gmail could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    const message = `Gmail ${res.status} on ${path}: ${detail}`;
    // 403 is both "you have no such permission", which will never come right,
    // and "slow down", which will. Gmail says which in the body.
    const backoff = res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(detail);
    if (res.status === 429 || res.status >= 500 || backoff) throw new TransientError(message);
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export type GmailProfile = {
  emailAddress: string;
  messagesTotal?: number;
};

export function getProfile(accessToken: string): Promise<GmailProfile> {
  return request<GmailProfile>(accessToken, "/profile");
}

export type MessageHeader = { name: string; value: string };

export type MessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: MessageHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: MessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  /** Gmail's own one-line preview, which is enough to title a signal. */
  snippet?: string;
  /** Epoch ms, as a string. */
  internalDate?: string;
  payload?: MessagePart;
};

/**
 * Message ids matching a Gmail search, newest first.
 *
 * One page only, like the GitHub search: past a certain number of unanswered
 * things, running an agent over all of them is the wrong answer and paging
 * would only make it a more expensive wrong answer.
 */
export async function listMessages(
  accessToken: string,
  query: string,
  max: number,
): Promise<string[]> {
  const path = `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`;
  // Gmail leaves `messages` out entirely when nothing matches.
  const result = await request<{ messages?: Array<{ id: string }> }>(accessToken, path);
  return (result.messages ?? []).map((entry) => entry.id);
}

/**
 * Just enough to recognise a message, without pulling its body down.
 *
 * Polling only needs to say what arrived and title it, and bodies are the
 * expensive part of a mailbox. The whole message is fetched later, once
 * something is actually going to be done with it.
 */
export function getMessageHeaders(accessToken: string, id: string): Promise<GmailMessage> {
  const headers = ["From", "To", "Subject", "Date", "List-Id"]
    .map((name) => `&metadataHeaders=${name}`)
    .join("");
  return request<GmailMessage>(accessToken, `/messages/${id}?format=metadata${headers}`);
}

export function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return request<GmailMessage>(accessToken, `/messages/${id}?format=full`);
}
