/**
 * cursor-agent can report as a stream of JSON events instead of printing one
 * block at the end. That is the difference between watching a four minute run
 * and staring at a spinner, and it hands us the final answer as a field
 * rather than as whatever happened to reach stdout.
 */

type ToolCall = Record<string, { args?: Record<string, unknown> }>;

type CursorEvent = {
  type?: string;
  subtype?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  tool_call?: ToolCall;
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  model?: string;
  /** Present on the streamed pieces, absent on the whole message. */
  timestamp_ms?: number;
};

function parse(line: string): CursorEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as CursorEvent;
  } catch {
    return null;
  }
}

function textOf(event: CursorEvent): string {
  return (event.message?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

/** `readToolCall` with a path becomes `read <path>`. */
function describeTool(call: ToolCall | undefined, cwd?: string): string {
  const [name, body] = Object.entries(call ?? {})[0] ?? [];
  if (!name) return "a tool";
  const verb = name.replace(/ToolCall$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const args = body?.args ?? {};
  const subject = args.path ?? args.command ?? args.query ?? args.pattern;
  if (typeof subject !== "string") return verb;
  // Everything the agent touches lives in the run directory, so its name is
  // the only interesting part of the path.
  const short = cwd && subject.startsWith(`${cwd}/`) ? subject.slice(cwd.length + 1) : subject;
  return `${verb} ${short}`;
}

/**
 * One readable line for the log, or nothing when the event says nothing a
 * person would want to read. Partial answer deltas are dropped: the whole
 * answer arrives at the end, and showing both would print it twice.
 */
export function describeEvent(line: string, cwd?: string): string | null {
  const event = parse(line);
  if (!event) return line.trim() === "" ? null : line;

  switch (event.type) {
    case "system":
      return event.model ? `Started with ${event.model}.` : "Started.";
    case "tool_call":
      return event.subtype === "started" ? `Running ${describeTool(event.tool_call, cwd)}` : null;
    case "assistant":
      return null;
    case "result": {
      const seconds = event.duration_ms ? (event.duration_ms / 1000).toFixed(0) : "?";
      const tokens = event.usage?.outputTokens;
      const spent = tokens === undefined ? "" : `, ${tokens} tokens out`;
      return event.is_error
        ? `Failed after ${seconds}s${spent}.`
        : `Answered after ${seconds}s${spent}.`;
    }
    default:
      return null;
  }
}

/**
 * The answer, which is the agent's last message and not everything it said.
 *
 * The result event looks like the obvious source and is the wrong one: it
 * concatenates every word of the run, so an answer taken from there begins
 * "I'll start by reading the two files" and that is what gets posted. Each
 * block of speech is streamed in stamped pieces and then repeated whole and
 * unstamped, so the last unstamped one is the answer and the earlier ones are
 * the agent thinking out loud between tools.
 */
export function answerFrom(stdout: string): { text: string; failed: boolean } {
  const events = stdout.split("\n").map(parse);
  const result = events.filter((event) => event?.type === "result").at(-1);
  const failed = result?.is_error === true;

  const whole = events.findLastIndex(
    (event) => event?.type === "assistant" && event.timestamp_ms === undefined,
  );
  if (whole >= 0) return { text: textOf(events[whole]!).trim(), failed };

  // No final message means the run was cut off. Everything after the last
  // tool call is the block it was in the middle of, which is the closest
  // thing to an answer it got to; earlier blocks are it thinking out loud.
  const lastTool = events.findLastIndex((event) => event?.type === "tool_call");
  const partial = events
    .slice(lastTool + 1)
    .filter((event) => event?.type === "assistant")
    .map((event) => textOf(event!));
  if (partial.length > 0) return { text: partial.join("").trim(), failed };

  return { text: (result?.result ?? "").trim(), failed };
}
