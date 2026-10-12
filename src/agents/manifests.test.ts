import { describe, expect, it } from "vitest";
import { AGENT_MANIFESTS, fallbackAgent } from "./manifests.ts";

describe("fallbackAgent", () => {
  it("is the chosen default when a runner has it", () => {
    expect(fallbackAgent("claude", ["codex", "claude"])).toBe("claude");
  });

  it("is the first of the catalog a runner has, when nothing is chosen or the choice is offline", () => {
    const first = AGENT_MANIFESTS[0]!.id;
    expect(fallbackAgent(null, ["cursor-agent", first])).toBe(first);
    expect(fallbackAgent("cursor-agent", [first])).toBe(first);
  });

  it("is nothing when no runner has any agent", () => {
    expect(fallbackAgent("codex", [])).toBeNull();
  });
});
