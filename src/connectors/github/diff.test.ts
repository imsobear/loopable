import { describe, expect, it } from "vitest";
import { annotate } from "./diff.ts";

const PATCH = [
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
].join("\n");

describe("annotate", () => {
  it("numbers the lines of the new file and leaves removals unnumbered", () => {
    const { text } = annotate(PATCH);
    expect(text.split("\n")).toEqual([
      "      | @@ -1,4 +1,5 @@",
      "     1 | const a = 1;",
      "-     | const b = 2;",
      "+    2 | const b = 3;",
      "+    3 | const c = 4;",
      "     4 | const d = 5;",
    ]);
  });

  it("offers only the lines that exist in the new file", () => {
    expect(annotate(PATCH).lines).toEqual([1, 2, 3, 4]);
  });

  it("keeps the diff marker first, so the block still reads as a diff", () => {
    for (const line of annotate(PATCH).text.split("\n").slice(1)) {
      expect(line[0]).toMatch(/[ +-]/);
    }
  });

  it("restarts at each hunk", () => {
    const { lines } = annotate(
      ["@@ -1,2 +1,2 @@", " one", "+two", "@@ -40,2 +50,2 @@", " forty", "+fifty"].join("\n"),
    );
    expect(lines).toEqual([1, 2, 50, 51]);
  });

  it("leaves a no-newline note out of the numbering", () => {
    const { text, lines } = annotate(
      ["@@ -1,1 +1,1 @@", "-old", "+new", "\\ No newline at end of file"].join("\n"),
    );
    expect(lines).toEqual([1]);
    expect(text).toContain("      | \\ No newline at end of file");
  });

  it("numbers nothing before the first hunk header", () => {
    // A patch that starts with file headers rather than a hunk: there is no
    // line number to give yet, and inventing one would aim comments at the
    // wrong place.
    const { lines } = annotate(["diff --git a/x b/x", "+++ b/x", "@@ -1,1 +7,1 @@", "+seven"].join("\n"));
    expect(lines).toEqual([7]);
  });
});
