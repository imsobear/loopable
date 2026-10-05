import { describe, expect, it } from "vitest";
import {
  filesFromWorkItem,
  isAgentNothing,
  jobRequiresHost,
  normalizeFolder,
  resolveFolder,
} from "./agent-job.ts";

describe("jobRequiresHost", () => {
  it("is only true for an old absolute folder", () => {
    expect(jobRequiresHost({})).toBe(false);
    expect(jobRequiresHost({ cwd: "code/web" })).toBe(false);
    expect(jobRequiresHost({ cwd: "/Users/me/code" })).toBe(true);
  });
});

describe("folders", () => {
  it("are kept relative to home, with or without ~/", () => {
    expect(normalizeFolder(" ~/code/web ")).toBe("code/web");
    expect(normalizeFolder("code/web")).toBe("code/web");
  });

  it("resolve under each runner's own home", () => {
    expect(resolveFolder("code/web", "/Users/maya")).toBe("/Users/maya/code/web");
    expect(resolveFolder("~/code/web", "/home/wei")).toBe("/home/wei/code/web");
    // From before folders were relative: left as written.
    expect(resolveFolder("/Users/me/code", "/home/wei")).toBe("/Users/me/code");
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
