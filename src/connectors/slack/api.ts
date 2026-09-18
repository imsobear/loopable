/**
 * Slack Web API, called with a bot token pasted from a workspace-installed app.
 * Loopable polls; Slack never has to reach this machine.
 */

import { TransientError } from "../errors.ts";

const API = "https://slack.com/api";

export type SlackCredential = {
  botToken: string;
  teamId: string;
  team: string;
  teamUrl: string;
  botUserId: string;
  botId: string;
};

export type SlackChannel = {
  id: string;
  name: string;
  isIm: boolean;
};

export type SlackMessage = {
  ts: string;
  user?: string;
  botId?: string;
  text: string;
  threadTs?: string;
};

type SlackEnvelope = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

async function slack(
  path: string,
  token: string,
  init: { method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<SlackEnvelope> {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url.href, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    throw new TransientError(`Slack is unreachable: ${(error as Error).message}`);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransientError(`Slack answered ${response.status}`);
  }
  if (!response.ok) throw new Error(`Slack answered ${response.status}`);
  return (await response.json()) as SlackEnvelope;
}

function refuse(error: string | undefined): never {
  if (error === "invalid_auth" || error === "not_authed" || error === "token_revoked" || error === "account_inactive") {
    throw new Error("Slack did not accept that token.");
  }
  throw new Error(error ? `Slack refused: ${error}` : "Slack refused the request.");
}

export async function authTest(botToken: string): Promise<SlackCredential> {
  const body = await slack("auth.test", botToken);
  if (!body.ok) refuse(body.error);
  const teamUrl = typeof body.url === "string" ? body.url : "";
  const team = typeof body.team === "string" ? body.team : "";
  const teamId = typeof body.team_id === "string" ? body.team_id : "";
  const botUserId = typeof body.user_id === "string" ? body.user_id : "";
  const botId = typeof body.bot_id === "string" ? body.bot_id : "";
  if (!teamId || !botUserId) throw new Error("Slack did not return which workspace this bot belongs to.");
  return { botToken, teamId, team, teamUrl, botUserId, botId };
}

export async function listConversations(credential: SlackCredential): Promise<SlackChannel[]> {
  const body = await slack("conversations.list", credential.botToken, {
    query: {
      types: "public_channel,private_channel,im,mpim",
      exclude_archived: "true",
      limit: "200",
    },
  });
  if (!body.ok) refuse(body.error);
  const channels = Array.isArray(body.channels) ? body.channels : [];
  return channels
    .map((raw) => {
      const channel = raw as { id?: string; name?: string; is_im?: boolean };
      if (!channel.id) return null;
      return { id: channel.id, name: channel.name ?? "", isIm: channel.is_im === true };
    })
    .filter((channel): channel is SlackChannel => channel !== null);
}

export async function history(
  credential: SlackCredential,
  channelId: string,
  oldest?: string,
): Promise<SlackMessage[]> {
  const query: Record<string, string> = {
    channel: channelId,
    limit: "100",
    inclusive: "false",
  };
  if (oldest) query.oldest = oldest;
  const body = await slack("conversations.history", credential.botToken, { query });
  if (!body.ok) {
    if (body.error === "not_in_channel" || body.error === "channel_not_found") return [];
    refuse(body.error);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const parsed: SlackMessage[] = [];
  for (const raw of messages) {
    const message = raw as {
      ts?: string;
      user?: string;
      bot_id?: string;
      text?: string;
      thread_ts?: string;
    };
    if (!message.ts) continue;
    parsed.push({
      ts: message.ts,
      ...(message.user ? { user: message.user } : {}),
      ...(message.bot_id ? { botId: message.bot_id } : {}),
      text: message.text ?? "",
      ...(message.thread_ts ? { threadTs: message.thread_ts } : {}),
    });
  }
  return parsed.sort((a, b) => Number(a.ts) - Number(b.ts));
}

export async function postMessage(
  credential: SlackCredential,
  input: { channel: string; text: string; threadTs?: string },
): Promise<{ ts: string; channel: string }> {
  const body = await slack("chat.postMessage", credential.botToken, {
    method: "POST",
    body: {
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    },
  });
  if (!body.ok) refuse(body.error);
  const ts = typeof body.ts === "string" ? body.ts : "";
  const channel = typeof body.channel === "string" ? body.channel : input.channel;
  if (!ts) throw new Error("Slack accepted the message but did not say where it landed.");
  return { ts, channel };
}

export function permalink(credential: SlackCredential, channel: string, ts: string): string {
  const host = credential.teamUrl.replace(/\/$/, "");
  return `${host}/archives/${channel}/p${ts.replace(".", "")}`;
}
