import type { GmailMessage, MessagePart } from "./api.ts";

/** A Gmail message id, as a ref: short, stable, and unique to the mailbox. */
export function mailRef(id: string): string {
  return `mail#${id}`;
}

/**
 * Where to send someone who wants to see the mail itself. Gmail has no
 * per-message API link, but the web client will open one by id.
 */
export function permalink(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

export function headerOf(message: GmailMessage, name: string): string {
  const wanted = name.toLowerCase();
  const found = (message.payload?.headers ?? []).find(
    (header) => header.name.toLowerCase() === wanted,
  );
  return found?.value.trim() ?? "";
}

/** The address out of `Some One <one@example.com>`, or the whole thing if bare. */
export function addressOf(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled ? angled[1]! : from).trim().toLowerCase();
}

/** The name out of `Some One <one@example.com>`, falling back to the address. */
export function senderName(from: string): string {
  const before = from.split("<")[0]!.trim().replace(/^"|"$/g, "");
  return before || addressOf(from);
}

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * Tags out, text kept, in the order a reader would meet it.
 *
 * Only reached for mail that carries no plain text part at all. It is not
 * trying to be a renderer: an agent reading this needs the words and roughly
 * where the line breaks were, and everything else is noise it would have to
 * see past.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The readable body, preferring what the sender wrote as text.
 *
 * A message is a tree, and a normal one from a normal client has both a plain
 * and an HTML version of the same words. Taking plain text where it exists
 * avoids ever having to guess at markup; the walk below collects both on one
 * pass and only falls back when there was no text part.
 */
export function bodyText(message: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: MessagePart | undefined) => {
    if (!part) return;
    const type = (part.mimeType ?? "").toLowerCase();
    // An attachment carries no data inline, and its filename is not body text.
    const attached = Boolean(part.filename) || Boolean(part.body?.attachmentId);
    if (!attached && part.body?.data) {
      if (type === "text/plain") plain.push(decode(part.body.data));
      else if (type === "text/html") html.push(decode(part.body.data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);

  const text = plain.join("\n").trim();
  if (text) return text;
  const markup = html.join("\n").trim();
  return markup ? htmlToText(markup) : (message.snippet ?? "").trim();
}

/** The attachments, named only. Nothing downloads them; the agent should know. */
export function attachmentNames(message: GmailMessage): string[] {
  const names: string[] = [];
  const walk = (part: MessagePart | undefined) => {
    if (!part) return;
    if (part.filename) names.push(part.filename);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  return names;
}

/** Enough of a message to pick it out of a list. */
export function summarise(message: GmailMessage): string {
  const subject = headerOf(message, "Subject") || "(no subject)";
  const who = senderName(headerOf(message, "From"));
  const title = who ? `${who}: ${subject}` : subject;
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}

/**
 * A long mail is cut rather than sent whole. What follows this is an agent
 * with a context window and, at the end of the chain, a phone: a mailing list
 * digest read to the last line helps nobody and costs the run.
 */
const BODY_LIMIT = 20_000;

/** The mail as the agent reads it: one file, headers first, then the words. */
export function mailContext(message: GmailMessage): { name: string; body: string } {
  const body = bodyText(message);
  const clipped =
    body.length > BODY_LIMIT
      ? `${body.slice(0, BODY_LIMIT)}\n\n[cut here: the message is longer than this]`
      : body;
  const attachments = attachmentNames(message);
  const date = headerOf(message, "Date");

  return {
    name: "EMAIL.md",
    body: [
      `# ${headerOf(message, "Subject") || "(no subject)"}`,
      ``,
      `From: ${headerOf(message, "From") || "(unknown)"}`,
      ...(headerOf(message, "To") ? [`To: ${headerOf(message, "To")}`] : []),
      ...(date ? [`Date: ${date}`] : []),
      ...(attachments.length > 0
        ? [`Attachments (not included here): ${attachments.join(", ")}`]
        : []),
      ``,
      `---`,
      ``,
      clipped || "(this message has no readable text)",
      ``,
    ].join("\n"),
  };
}
