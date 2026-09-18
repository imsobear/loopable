import { agentRuntime } from "#/agents/runtimes.ts";
import type { Signal } from "#/connectors/types.ts";
import { settingsFor } from "./agents.ts";

/**
 * Deciding what is worth an agent run, with one agent run.
 *
 * A loop that watches an inbox spends a full run on every message, and most
 * messages are receipts and newsletters. The waste is not only the run: the
 * answer still gets delivered, so a quiet day arrives as six notifications
 * that each say nothing is needed. That is worse than the cost, because it
 * teaches you to stop reading them.
 *
 * So one run looks at everything the poll found, using only what the poll
 * already had in hand, and says which ones are asking something of you. The
 * rest are held rather than dropped: held work keeps its place in the backlog
 * with a reason, and can still be run deliberately, so a wrong call here
 * costs a click rather than a message you never saw.
 */

/** What a triaged batch decided, by signal key. */
export type Triage = Map<string, string>;

const NOTHING_ASKED = "nothing in it was being asked of you";

/**
 * The batch is numbered rather than named because the agent has to point back
 * at these, and a subject line is not a usable handle: two mails can share
 * one, and any of them can contain the quotes and newlines that would break
 * the answer apart.
 */
function listFor(signals: Signal[]): string {
  return signals
    .map((signal, index) => {
      const preview = signal.preview ? `\n   ${signal.preview.slice(0, 300)}` : "";
      return `${index + 1}. ${signal.title}${preview}`;
    })
    .join("\n\n");
}

function promptFor(signals: Signal[], guidance: string | null): string {
  const lines = [
    "Below are things that just arrived. Say which ones are asking something",
    "of the person who received them.",
    "",
    "Asking something means there is a decision to make, a reply expected, a",
    "form to fill, a payment due, a meeting to book, a deadline, or a problem",
    "to look at. Receipts, statements, newsletters, marketing, social",
    "notifications, and automated reports are not asking anything, even when",
    "they are about money, and even when they are worth having read.",
    "",
    "When you cannot tell from what is here, treat it as asking something.",
    "Being told about one thing too many is a small cost; missing the one that",
    "mattered is not.",
  ];
  if (guidance) {
    lines.push(
      "",
      "What this person has said they care about, which outranks the above:",
      guidance,
    );
  }
  lines.push(
    "",
    'Answer with JSON only, no other text: {"needsMe": [1, 4]}, listing the',
    "numbers that are asking something. An empty list is a valid answer.",
    "",
    listFor(signals),
  );
  return lines.join("\n");
}

/**
 * The numbers the agent picked out, as indices. Anything unparseable gives
 * nothing back, which the caller reads as "could not tell" rather than as
 * "none of them": a triage that failed must not be the reason work went
 * unnoticed.
 */
export function parseAnswer(output: string, count: number): Set<number> | null {
  // The agent is asked for bare JSON and mostly obliges, but a fenced block or
  // a sentence in front of it is not worth failing over.
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
  const listed = (parsed as { needsMe?: unknown })?.needsMe;
  if (!Array.isArray(listed)) return null;

  const chosen = new Set<number>();
  for (const entry of listed) {
    // Numbers, or the strings they sometimes come back as.
    const value = typeof entry === "number" ? entry : Number.parseInt(String(entry), 10);
    if (Number.isInteger(value) && value >= 1 && value <= count) chosen.add(value - 1);
  }
  return chosen;
}

/**
 * Which of these need not be run, and why. An empty result means everything
 * runs, which is what happens whenever the answer cannot be trusted: too few
 * to be worth a run, an agent that failed, or an answer that made no sense.
 */
export async function triage(input: {
  signals: Signal[];
  agentId: string;
  guidance: string | null;
  cwd: string;
  signal?: AbortSignal;
}): Promise<Triage> {
  const held: Triage = new Map();
  // A single item cannot pay for this: one run to decide whether to do one run
  // is the same money at best. Two can, and usually does, because most of what
  // arrives is not asking anything.
  //
  // This was three, which sounds safer and quietly turned the whole thing off:
  // things arrive one at a time, so a look often enough to feel prompt almost
  // never has three to compare, and everything went through unweighed. Whether
  // there is a batch to judge is decided by how long the loop waits between
  // looks, not here.
  if (input.signals.length < 2) return held;

  const result = await agentRuntime(input.agentId).run({
    prompt: promptFor(input.signals, input.guidance),
    cwd: input.cwd,
    settings: await settingsFor(input.agentId),
    signal: input.signal,
  });
  if (!result.ok || result.aborted) return held;

  const needsMe = parseAnswer(result.output, input.signals.length);
  if (!needsMe) return held;

  input.signals.forEach((entry, index) => {
    if (!needsMe.has(index)) held.set(entry.key, NOTHING_ASKED);
  });
  return held;
}
