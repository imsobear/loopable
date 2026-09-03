import { describe, expect, it } from "vitest";
import { answerFrom, describeEvent } from "./events.ts";

/** Captured from a real `cursor-agent --output-format stream-json` run. */
const INIT = `{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp/x","session_id":"s1","model":"Claude Opus 5 300K High","permissionMode":"default"}`;
const TOOL_STARTED = `{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/x/note.txt"}},"toolCallId":"c1"},"session_id":"s1","timestamp_ms":1788458419689}`;
const TOOL_DONE = `{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/x/note.txt"},"result":{"success":{"content":"hello\\n"}}},"toolCallId":"c1"},"session_id":"s1","timestamp_ms":1788458426009}`;
const DELTA_ONE = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"h"}]},"session_id":"s1","timestamp_ms":1788458427402}`;
const DELTA_TWO = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ello"}]},"session_id":"s1","timestamp_ms":1788458427477}`;
const WHOLE = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]},"session_id":"s1"}`;
const RESULT = `{"type":"result","subtype":"success","duration_ms":20854,"is_error":false,"result":"hello","session_id":"s1","usage":{"inputTokens":4,"outputTokens":104}}`;

const FULL_RUN = [INIT, TOOL_STARTED, TOOL_DONE, DELTA_ONE, DELTA_TWO, WHOLE, RESULT].join("\n");

/**
 * A real narrated run, captured from cursor-agent: the agent speaks, uses a
 * tool, then answers. Every piece carries a timestamp, including the repeat
 * that closes a block of speech; only the very last message does not, which
 * is what makes it the answer.
 */
const NARRATION = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Looking at the files now"}]},"session_id":"s1","timestamp_ms":1788458400001}`;
const NARRATION_REPEAT = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Looking at the files now"}]},"session_id":"s1","timestamp_ms":1788458400002}`;
const ANSWER_DELTA = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"## Review\\n\\nLooks"}]},"session_id":"s1","timestamp_ms":1788458427402}`;
const ANSWER = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"## Review\\n\\nLooks fine."}]},"session_id":"s1"}`;
const RESULT_ALL = `{"type":"result","subtype":"success","duration_ms":1000,"is_error":false,"result":"Looking at the files now## Review\\n\\nLooks fine."}`;

describe("answerFrom", () => {
  it("takes the last thing said, not everything said", () => {
    const run = [
      INIT,
      NARRATION,
      NARRATION_REPEAT,
      TOOL_STARTED,
      TOOL_DONE,
      ANSWER_DELTA,
      ANSWER,
      RESULT_ALL,
    ].join("\n");
    // The result field holds both; posting that would open with the narration.
    expect(answerFrom(run)).toEqual({ text: "## Review\n\nLooks fine.", failed: false });
  });

  it("reads a single-answer run", () => {
    expect(answerFrom(FULL_RUN)).toEqual({ text: "hello", failed: false });
  });

  it("reports a failed run", () => {
    const failed = `{"type":"result","subtype":"error","duration_ms":10,"is_error":true,"result":"could not read the file"}`;
    expect(answerFrom([INIT, failed].join("\n"))).toEqual({
      text: "could not read the file",
      failed: true,
    });
  });

  it("works without a result event at all", () => {
    const cut = [INIT, DELTA_ONE, DELTA_TWO, WHOLE].join("\n");
    expect(answerFrom(cut).text).toBe("hello");
  });

  /**
   * A stopped run never reaches the final message. Half an answer explains a
   * lot; the narration from before the tool call would only mislead.
   */
  it("keeps only the last block when the run was cut off mid-answer", () => {
    const cut = [INIT, NARRATION, NARRATION_REPEAT, TOOL_STARTED, ANSWER_DELTA].join("\n");
    expect(answerFrom(cut).text).toBe("## Review\n\nLooks");
  });

  it("says nothing when there is nothing", () => {
    expect(answerFrom("").text).toBe("");
    expect(answerFrom("not json at all").text).toBe("");
  });
});

describe("describeEvent", () => {
  it("names the model it started with", () => {
    expect(describeEvent(INIT)).toBe("Started with Claude Opus 5 300K High.");
  });

  it("reports a tool once, when it starts", () => {
    expect(describeEvent(TOOL_STARTED)).toBe("Running read /tmp/x/note.txt");
    expect(describeEvent(TOOL_DONE)).toBeNull();
  });

  it("drops the run directory from paths inside it", () => {
    expect(describeEvent(TOOL_STARTED, "/tmp/x")).toBe("Running read note.txt");
    expect(describeEvent(TOOL_STARTED, "/somewhere/else")).toBe("Running read /tmp/x/note.txt");
  });

  it("stays quiet about answer text, which is shown in full elsewhere", () => {
    expect(describeEvent(DELTA_ONE)).toBeNull();
    expect(describeEvent(WHOLE)).toBeNull();
  });

  it("closes with how long it took and what it spent", () => {
    expect(describeEvent(RESULT)).toBe("Answered after 21s, 104 tokens out.");
  });

  it("passes through anything that is not an event, which is where crashes appear", () => {
    expect(describeEvent("Error: command not found")).toBe("Error: command not found");
    expect(describeEvent("   ")).toBeNull();
  });
});
