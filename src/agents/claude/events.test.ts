import { describe, expect, it } from "vitest";
import { answerFrom, describeEvent } from "./events.ts";

/** Shaped like `claude -p --output-format stream-json --verbose`, trimmed to the fields we read. */
const INIT = `{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"s1","tools":["Glob","Grep","Read"],"model":"claude-sonnet-5-5","permissionMode":"dontAsk"}`;
const NARRATION = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Looking at the files now."}]},"session_id":"s1"}`;
const TOOL_USE = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/tmp/x/note.txt"}}]},"session_id":"s1"}`;
const TOOL_RESULT = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"hello"}]},"session_id":"s1"}`;
const ANSWER = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"## Review\\n\\nLooks fine."}]},"session_id":"s1"}`;
const RESULT = `{"type":"result","subtype":"success","is_error":false,"duration_ms":20854,"num_turns":2,"result":"## Review\\n\\nLooks fine.","session_id":"s1","usage":{"input_tokens":4,"output_tokens":104}}`;

/** Captured from a real run on a host that was not signed in. */
const SIGNED_OUT = [
  `{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"s2","tools":["Glob","Grep","Read"],"model":"claude-haiku-4-5","permissionMode":"dontAsk"}`,
  `{"type":"assistant","message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"Not logged in · Please run /login"}]},"session_id":"s2","error":"authentication_failed","is_api_error_message":true}`,
  `{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"duration_ms":300,"num_turns":1,"result":"Not logged in · Please run /login","session_id":"s2","usage":{"input_tokens":0,"output_tokens":0}}`,
].join("\n");

describe("answerFrom", () => {
  it("takes the result, which is the last thing said", () => {
    const run = [INIT, NARRATION, TOOL_USE, TOOL_RESULT, ANSWER, RESULT].join("\n");
    expect(answerFrom(run)).toEqual({ text: "## Review\n\nLooks fine.", failed: false });
  });

  it("reports a failed run with the reason", () => {
    expect(answerFrom(SIGNED_OUT)).toEqual({
      text: "Not logged in · Please run /login",
      failed: true,
    });
  });

  /**
   * A stopped run never reaches the result. Half an answer explains a lot; the
   * narration from before the tool use would only mislead.
   */
  it("keeps only what came after the last tool when the run was cut off", () => {
    const cut = [INIT, NARRATION, TOOL_USE, TOOL_RESULT, ANSWER].join("\n");
    expect(answerFrom(cut)).toEqual({ text: "## Review\n\nLooks fine.", failed: false });
  });

  it("says nothing when there is nothing", () => {
    expect(answerFrom("").text).toBe("");
    expect(answerFrom("not json at all").text).toBe("");
    expect(answerFrom([INIT, NARRATION, TOOL_USE].join("\n")).text).toBe("");
  });
});

describe("describeEvent", () => {
  it("names the model it started with", () => {
    expect(describeEvent(INIT)).toBe("Started with claude-sonnet-5-5.");
  });

  it("reports a tool when it is used", () => {
    expect(describeEvent(TOOL_USE)).toBe("Running read /tmp/x/note.txt");
    expect(describeEvent(TOOL_RESULT)).toBeNull();
  });

  it("drops the run directory from paths inside it", () => {
    expect(describeEvent(TOOL_USE, "/tmp/x")).toBe("Running read note.txt");
    expect(describeEvent(TOOL_USE, "/somewhere/else")).toBe("Running read /tmp/x/note.txt");
  });

  it("stays quiet about speech, which is shown in full elsewhere", () => {
    expect(describeEvent(NARRATION)).toBeNull();
    expect(describeEvent(ANSWER)).toBeNull();
  });

  it("closes with how long it took and what it spent", () => {
    expect(describeEvent(RESULT)).toBe("Answered after 21s, 104 tokens out.");
  });

  it("says why it failed", () => {
    const failed = SIGNED_OUT.split("\n")[2]!;
    expect(describeEvent(failed)).toBe(
      "Failed after 0s, 0 tokens out: Not logged in · Please run /login",
    );
  });

  it("passes through anything that is not an event, which is where crashes appear", () => {
    expect(describeEvent("Error: command not found")).toBe("Error: command not found");
    expect(describeEvent("   ")).toBeNull();
  });
});
