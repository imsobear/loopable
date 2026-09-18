import type { JsonValue } from "#/lib/domain.ts";
import type { ActionSource, ConnectorRuntime, Signal, WorkItem } from "../types.ts";
import {
  authTest,
  history,
  listConversations,
  permalink,
  postMessage,
  type SlackCredential,
} from "./api.ts";

type Asked = {
  channel: string;
  ts: string;
  user?: string;
  text: string;
  threadTs: string;
};

function asAsked(value: JsonValue | null): Asked {
  const record = value as Partial<Asked> | null;
  if (!record || typeof record.channel !== "string" || typeof record.ts !== "string") {
    throw new Error("This task has lost the message it was about.");
  }
  return {
    channel: record.channel,
    ts: record.ts,
    user: typeof record.user === "string" ? record.user : undefined,
    text: typeof record.text === "string" ? record.text : "",
    threadTs: typeof record.threadTs === "string" ? record.threadTs : record.ts,
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
  const line = text.replace(/<@[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!line) return "Slack message";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function isAsk(input: {
  text: string;
  user?: string;
  messageBotId?: string;
  isIm: boolean;
  botUserId: string;
  botId: string;
}): boolean {
  if (input.user === input.botUserId || (input.messageBotId && input.messageBotId === input.botId)) {
    return false;
  }
  if (input.isIm) return Boolean(input.text.trim());
  return input.text.includes(`<@${input.botUserId}>`);
}

function destination(
  target: Record<string, unknown>,
  source: ActionSource,
): { channel: string; threadTs?: string } {
  if (typeof target.channel === "string" && target.channel.trim()) {
    return { channel: target.channel.trim() };
  }
  if (source.connectorId !== "slack") {
    throw new Error("There is no Slack channel behind this task. Choose one on the loop.");
  }
  const carry = (source.carry ?? {}) as { channel?: string; ts?: string };
  if (!carry.channel) throw new Error("There is no Slack channel behind this task. Choose one on the loop.");
  return { channel: carry.channel, threadTs: carry.ts };
}

function accountOf(credential: SlackCredential) {
  return {
    id: credential.teamId,
    label: credential.team || credential.teamId,
    url: credential.teamUrl || undefined,
  };
}

export const slackRuntime: ConnectorRuntime = {
  async readiness() {
    return { ready: true };
  },

  async poll({ workflowId, credential, cursor }) {
    if (workflowId !== "slack.ask") {
      throw new Error(`Slack cannot watch for ${workflowId}.`);
    }
    const account = credential as SlackCredential;
    const previous = asCursor(cursor);
    const channels = await listConversations(account);
    const next: Record<string, string> = { ...previous };
    const signals: Signal[] = [];

    for (const channel of channels) {
      const oldest = previous[channel.id];
      const messages = await history(account, channel.id, oldest);
      if (messages.length === 0) {
        if (!next[channel.id]) next[channel.id] = String(Date.now() / 1000);
        continue;
      }
      next[channel.id] = messages[messages.length - 1]!.ts;
      if (!oldest) continue;
      for (const message of messages) {
        if (
          !isAsk({
            text: message.text,
            user: message.user,
            messageBotId: message.botId,
            isIm: channel.isIm,
            botUserId: account.botUserId,
            botId: account.botId,
          })
        ) {
          continue;
        }
        const asked: Asked = {
          channel: channel.id,
          ts: message.ts,
          user: message.user,
          text: message.text,
          threadTs: message.threadTs ?? message.ts,
        };
        signals.push({
          key: `${channel.id}:${message.ts}`,
          kind: "message",
          ref: `${channel.id}:${message.ts}`,
          title: summarise(message.text),
          url: permalink(account, channel.id, message.ts),
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
      ref: `${asked.channel}:${asked.ts}`,
      title: summarise(asked.text),
      url: "",
      carry: { channel: asked.channel, ts: asked.threadTs } as JsonValue,
      context: [
        {
          name: "MESSAGE.md",
          body: [`# What you were asked`, ``, asked.text, ``].join("\n"),
        },
      ],
    };
  },

  async applyAction({ actionId, target, source, body, credential }) {
    if (actionId !== "slack.reply") throw new Error(`Slack cannot ${actionId}.`);
    const account = credential as SlackCredential;
    const to = destination(target, source);
    const posted = await postMessage(account, {
      channel: to.channel,
      text: body.trim(),
      threadTs: to.threadTs,
    });
    return { url: permalink(account, posted.channel, posted.ts) };
  },

  auth: {
    async connectWithFields(fields) {
      const botToken = fields.botToken?.trim() ?? "";
      if (!botToken.startsWith("xoxb-")) {
        throw new Error("Paste the Bot User OAuth Token from your Slack app. It starts with xoxb-.");
      }
      const credential = await authTest(botToken);
      return { credential, account: accountOf(credential) };
    },

    async identity(credential: unknown) {
      const stored = credential as SlackCredential;
      const fresh = await authTest(stored.botToken);
      return { account: accountOf(fresh) };
    },
  },
};
