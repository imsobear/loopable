import { describe, expect, it } from "vitest";
import { anchorFindings, parseReview, reviewBody } from "./review.ts";

describe("parseReview", () => {
  it("reads a fenced object", () => {
    const answer = parseReview(
      [
        "```json",
        '{ "summary": "Looks fine.", "findings": [{ "path": "a.ts", "line": 4, "body": "Off by one." }] }',
        "```",
      ].join("\n"),
    );
    expect(answer).toEqual({
      summary: "Looks fine.",
      findings: [{ path: "a.ts", line: 4, body: "Off by one." }],
    });
  });

  it("reads a bare object, and ignores what an agent says around it", () => {
    const answer = parseReview(
      'Here is my review:\n\n{ "summary": "Fine.", "findings": [] }\n\nLet me know.',
    );
    expect(answer).toEqual({ summary: "Fine.", findings: [] });
  });

  it("keeps a range only when it is one", () => {
    const answer = parseReview(
      JSON.stringify({
        summary: "s",
        findings: [
          { path: "a.ts", startLine: 10, line: 14, body: "range" },
          { path: "a.ts", startLine: 14, line: 14, body: "same line" },
          { path: "a.ts", startLine: 20, line: 14, body: "backwards" },
        ],
      }),
    );
    expect(answer.findings).toEqual([
      { path: "a.ts", startLine: 10, line: 14, body: "range" },
      { path: "a.ts", line: 14, body: "same line" },
      { path: "a.ts", line: 14, body: "backwards" },
    ]);
  });

  it("drops a finding that is missing what it needs", () => {
    const answer = parseReview(
      JSON.stringify({
        summary: "s",
        findings: [
          { path: "a.ts", line: 4, body: "kept" },
          { path: "", line: 4, body: "no path" },
          { path: "a.ts", body: "no line" },
          { path: "a.ts", line: 0, body: "line zero" },
          { path: "a.ts", line: 4, body: "   " },
          "nonsense",
        ],
      }),
    );
    expect(answer.findings).toEqual([{ path: "a.ts", line: 4, body: "kept" }]);
  });

  it("takes prose at its word rather than failing on it", () => {
    // What an agent that ignored the format produced, which is what Loopable
    // did before it could anchor anything.
    const answer = parseReview("This looks good to me, though the retry loop worries me.");
    expect(answer).toEqual({
      summary: "This looks good to me, though the retry loop worries me.",
      findings: [],
    });
  });

  it("refuses broken JSON rather than posting the wreckage", () => {
    expect(() => parseReview('```json\n{ "summary": "oops", findings: [ }\n```')).toThrow(
      /could not be read/,
    );
  });

  it("skips a block that came out empty and takes the one that did not", () => {
    // A streamed answer can arrive twice, once in pieces and once whole.
    const answer = parseReview(
      ['```json', '{ "summary": "", "findings": [] }', "```", "```json", '{ "summary": "The real one." }', "```"].join("\n"),
    );
    expect(answer.summary).toBe("The real one.");
  });

  it("skips a partial block and takes the one that completed", () => {
    const answer = parseReview(
      ["```json", '{ "summary": "cut off her', "```", "```json", '{ "summary": "Whole." }', "```"].join("\n"),
    );
    expect(answer.summary).toBe("Whole.");
  });

  it("is not fooled by a fence of some other language coming first", () => {
    const answer = parseReview(
      ["Here is the offending code:", "```ts", "const x = {", "```", "```json", '{ "summary": "Found it." }', "```"].join("\n"),
    );
    expect(answer.summary).toBe("Found it.");
  });

  it("does not fail on prose that happens to contain braces", () => {
    const text = "The initialiser `{ a: 1 }` is fine, but the retry is not.";
    expect(parseReview(text)).toEqual({ summary: text, findings: [] });
  });
});

describe("anchorFindings", () => {
  const commentable = { "a.ts": [10, 11, 12], "b.ts": [4] };

  it("anchors what lands in the diff and sets aside what does not", () => {
    const { comments, loose } = anchorFindings(
      [
        { path: "a.ts", line: 11, body: "on a changed line" },
        { path: "a.ts", line: 99, body: "on a line not in the diff" },
        { path: "c.ts", line: 1, body: "in a file not in the diff" },
        { path: "b.ts", line: 4, body: "in another file" },
      ],
      commentable,
    );
    expect(comments.map((finding) => finding.body)).toEqual([
      "on a changed line",
      "in another file",
    ]);
    expect(loose.map((finding) => finding.body)).toEqual([
      "on a line not in the diff",
      "in a file not in the diff",
    ]);
  });

  it("needs both ends of a range to be in the diff", () => {
    const { comments, loose } = anchorFindings(
      [
        { path: "a.ts", startLine: 10, line: 12, body: "both ends" },
        { path: "a.ts", startLine: 2, line: 12, body: "start is outside" },
      ],
      commentable,
    );
    expect(comments).toHaveLength(1);
    expect(loose).toHaveLength(1);
  });

  it("anchors nothing when there is nothing to check against", () => {
    // Guessing would risk GitHub refusing the review outright, which would
    // lose every finding rather than one position.
    const { comments, loose } = anchorFindings([{ path: "a.ts", line: 11, body: "x" }], undefined);
    expect(comments).toEqual([]);
    expect(loose).toHaveLength(1);
  });
});

describe("reviewBody", () => {
  it("is the summary alone when everything was anchored", () => {
    expect(reviewBody("Looks reasonable.", [])).toBe("Looks reasonable.");
  });

  it("writes out where an unanchored finding belongs", () => {
    expect(
      reviewBody("Two things.", [
        { path: "a.ts", line: 99, body: "This retry never terminates." },
        { path: "b.ts", startLine: 4, line: 8, body: "This block is dead." },
      ]),
    ).toBe(
      [
        "Two things.",
        "",
        "**a.ts:99**",
        "",
        "This retry never terminates.",
        "",
        "**b.ts:4-8**",
        "",
        "This block is dead.",
      ].join("\n"),
    );
  });
});
