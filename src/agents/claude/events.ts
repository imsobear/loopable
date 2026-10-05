/**
 * claude reports as a stream of JSON events in print mode, one line each. Every
 * assistant event is a whole message, so unlike cursor-agent there are no
 * partial pieces to skip: the run reads as speech, tool uses, and a result.
 */

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
};

type ClaudeEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  message?: { content?: ContentBlock[] };
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  usage?: { output_tokens?: number };
};

function parse(line: string): ClaudeEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as ClaudeEvent;
  } catch {
    return null;
  }
}

function blocks(event: ClaudeEvent | null): ContentBlock[] {
  return event?.type === "assistant" ? (event.message?.content ?? []) : [];
}

/** `Read` with a file_path becomes `read <path>`. */
function describeTool(block: ContentBlock, cwd?: string): string {
  const verb = (block.name ?? "a tool").toLowerCase();
  const input = block.input ?? {};
  const subject = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.query;
  if (typeof subject !== "string") return verb;
  // Everything the agent touches lives in the run directory, so its name is
  // the only interesting part of the path.
  const short = cwd && subject.startsWith(`${cwd}/`) ? subject.slice(cwd.length + 1) : subject;
  return `${verb} ${short}`;
}

/**
 * One readable line for the log, or nothing when the event says nothing a
 * person would want to read. Speech is left out: the answer is shown in full
 * elsewhere, and the narration in between is what the tool lines already say.
 */
export function describeEvent(line: string, cwd?: string): string | null {
  const event = parse(line);
  if (!event) return line.trim() === "" ? null : line;

  switch (event.type) {
    case "system":
      if (event.subtype !== "init") return null;
      return event.model ? `Started with ${event.model}.` : "Started.";
    case "assistant": {
      const tools = blocks(event)
        .filter((block) => block.type === "tool_use")
        .map((block) => `Running ${describeTool(block, cwd)}`);
      return tools.length > 0 ? tools.join("\n") : null;
    }
    case "result": {
      const seconds = event.duration_ms !== undefined ? (event.duration_ms / 1000).toFixed(0) : "?";
      const tokens = event.usage?.output_tokens;
      const spent = tokens === undefined ? "" : `, ${tokens} tokens out`;
      return event.is_error
        ? `Failed after ${seconds}s${spent}: ${event.result ?? event.subtype ?? "unknown error"}`
        : `Answered after ${seconds}s${spent}.`;
    }
    default:
      return null;
  }
}

/**
 * The answer, which is the agent's last message and not everything it said.
 *
 * The result event carries exactly that, so it wins when present. A stopped
 * run never gets one; then the text after the last tool use is the block it
 * was in the middle of, and earlier text is it thinking out loud.
 */
export function answerFrom(stdout: string): { text: string; failed: boolean } {
  const events = stdout.split("\n").map(parse);
  const result = events.filter((event) => event?.type === "result").at(-1);
  const failed = result?.is_error === true;
  if (typeof result?.result === "string" && result.result.trim() !== "") {
    return { text: result.result.trim(), failed };
  }

  const said = events.flatMap(blocks);
  const lastTool = said.findLastIndex((block) => block.type === "tool_use");
  const text = said
    .slice(lastTool + 1)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  return { text, failed };
}
