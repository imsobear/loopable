import type { JsonValue } from "#/lib/domain.ts";
import type { Signal } from "../types.ts";
import { getMessageHeaders, listMessages, type GmailMessage } from "./api.ts";
import { gmailManifest } from "./manifest.ts";
import { addressOf, headerOf, mailRef, permalink, summarise } from "./mail.ts";

/**
 * What the workflow says it watches for, which is what gets asked. Taken from
 * the manifest rather than written again here, because it is shown on the loop
 * page and a query that quietly differed from the one on screen would be the
 * worst kind of wrong.
 */
function baseQuery(workflowId: string): string {
  const workflow = gmailManifest.workflows.find((entry) => entry.id === workflowId);
  if (!workflow?.watches) throw new Error(`Gmail cannot watch for ${workflowId}.`);
  return workflow.watches;
}

/**
 * Missing means "the workflow's default", not "off". A loop saved before a
 * setting existed must behave as if it had been there all along.
 */
function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function count(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** What Loopable asks Gmail: the workflow's query, then whatever the loop adds. */
export function queryFor(workflowId: string, settings: Record<string, unknown>): string {
  const extra = text(settings.extraQuery);
  return extra ? `${baseQuery(workflowId)} ${extra}` : baseQuery(workflowId);
}

/** What the poll keeps, so the work can be picked up again later. */
export type MailPayload = { messageId: string };

export async function pollGmail(input: {
  workflowId: string;
  settings: Record<string, unknown>;
  accessToken: string;
  /** The connected mailbox, so mail you sent yourself can be recognised. */
  emailAddress: string;
}): Promise<Signal[]> {
  if (input.workflowId !== "gmail.new_mail") {
    throw new Error(`Gmail cannot watch for ${input.workflowId}.`);
  }

  const max = count(input.settings.maxPerPoll, 10);
  const ids = await listMessages(
    input.accessToken,
    queryFor(input.workflowId, input.settings),
    max,
  );
  const skipOwn = boolean(input.settings.skipOwn, true);
  const me = input.emailAddress.toLowerCase();

  const signals: Signal[] = [];
  for (const id of ids) {
    // Headers only. The body is fetched when there is something to do with it,
    // which for most of a mailbox is never.
    const message: GmailMessage = await getMessageHeaders(input.accessToken, id);
    if (skipOwn && addressOf(headerOf(message, "From")) === me) continue;

    signals.push({
      // The id, and nothing about the mail's state: a message is one piece of
      // work whether or not it has since been read, replied to or filed.
      key: mailRef(id),
      kind: "email",
      ref: mailRef(id),
      title: summarise(message),
      url: permalink(id),
      // Gmail's own preview line, which the metadata fetch returns whether or
      // not it is asked for. Enough to tell a bank statement from a person
      // waiting on an answer, without fetching the body.
      preview: (message.snippet ?? "").trim() || undefined,
      // Only the id. Unlike a chat message, mail stays where it is and can be
      // read again when the work actually runs, so keeping a copy of every
      // body in SQLite would be paying to store the mailbox twice.
      payload: { messageId: id } satisfies MailPayload as unknown as JsonValue,
    });
  }
  return signals;
}
