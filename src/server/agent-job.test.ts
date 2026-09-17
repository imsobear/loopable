import { describe, expect, it } from "vitest";
import { filesFromWorkItem, isAgentNothing, jobRequiresHost } from "./agent-job.ts";

describe("jobRequiresHost", () => {
  it("is only true when the job names a host folder", () => {
    expect(jobRequiresHost({})).toBe(false);
    expect(jobRequiresHost({ cwd: "/Users/me/code" })).toBe(true);
  });
});

describe("isAgentNothing", () => {
  it("recognises the exact token, even with markdown wrapping", () => {
    expect(isAgentNothing("NOTHING_TO_DO")).toBe(true);
    expect(isAgentNothing("`NOTHING_TO_DO`")).toBe(true);
    expect(isAgentNothing("looks fine")).toBe(false);
  });
});

describe("filesFromWorkItem", () => {
  it("copies context files and nothing else", () => {
    expect(
      filesFromWorkItem({
        context: [
          { name: "pr.md", body: "hello" },
          { name: "diff.patch", body: "@@" },
        ],
      }),
    ).toEqual([
      { name: "pr.md", body: "hello" },
      { name: "diff.patch", body: "@@" },
    ]);
  });
});
