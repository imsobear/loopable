/**
 * A review that points at lines, rather than a wall of prose that describes
 * the change back to the person who wrote it.
 *
 * Anchoring is the whole difficulty. GitHub rejects an entire review if one
 * comment names a line that is not part of the diff, so a single mistaken
 * number would lose everything the agent had to say. Every anchor is therefore
 * checked against the diff first, and a finding that cannot be placed is moved
 * into the body with its location written out, because losing the point is
 * worse than losing its position.
 */

/** One thing the agent found, and where it belongs. */
export type Finding = {
  path: string;
  /** A line in the new version of the file. */
  line: number;
  /** Set when the finding is about a range ending at `line`. */
  startLine?: number;
  body: string;
};

export type ReviewAnswer = {
  summary: string;
  findings: Finding[];
};

/** Which lines of which files a comment may be attached to. */
export type Commentable = Record<string, number[]>;

/**
 * Appended to the workflow's prompt, because the shape of the answer is the
 * machinery's business and the workflow should only have to describe the job.
 */
export const REVIEW_FORMAT = [
  `Reply with one JSON object and nothing else, in this shape:`,
  ``,
  `{`,
  `  "summary": "a few sentences on the change as a whole",`,
  `  "findings": [`,
  `    { "path": "src/thing.ts", "line": 42, "body": "what is wrong, and what to do" },`,
  `    { "path": "src/thing.ts", "startLine": 60, "line": 64, "body": "for a point about several lines" }`,
  `  ]`,
  `}`,
  ``,
  `- "path" is the path of the file in the repository.`,
  `- "line" is the line number in the new version of the file. Only comment on`,
  `  lines that this pull request changed; a comment on a line that is not in`,
  `  the diff will be moved into the summary instead of attached.`,
  `- One finding per point, placed where a reader has to look rather than where`,
  `  you happened to notice it.`,
  `- "body" is markdown with no heading.`,
  `- "findings" may be empty when the summary says everything worth saying.`,
].join("\n");

/**
 * Everything in the reply that might be the object, best first.
 *
 * More than one is offered on purpose. A streamed answer can arrive twice,
 * once in pieces and once whole, and a reply can carry an example alongside
 * the real thing, so the first block that looks like JSON is not reliably the
 * one that is. Each is tried in turn and the first that parses wins.
 */
function jsonCandidates(text: string): { labelled: string[]; rest: string[] } {
  const fences = (pattern: RegExp) =>
    [...text.matchAll(pattern)].map((match) => (match[1] ?? "").trim()).filter(Boolean);

  const labelled = fences(/```json\s*\n([\s\S]*?)```/gi);
  const rest = fences(/```\s*\n([\s\S]*?)```/g);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) rest.push(text.slice(start, end + 1));

  return { labelled, rest };
}

function answerFrom(json: string): ReviewAnswer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const value = parsed as Record<string, unknown>;
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const findings = Array.isArray(value.findings)
    ? value.findings.flatMap((entry) => {
        const finding = findingFrom(entry);
        return finding ? [finding] : [];
      })
    : [];

  return summary || findings.length > 0 ? { summary, findings } : null;
}

function findingFrom(value: unknown): Finding | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const path = typeof entry.path === "string" ? entry.path.trim() : "";
  const line = typeof entry.line === "number" ? Math.trunc(entry.line) : Number.NaN;
  const body = typeof entry.body === "string" ? entry.body.trim() : "";
  if (!path || !body || !Number.isFinite(line) || line < 1) return null;

  const start = typeof entry.startLine === "number" ? Math.trunc(entry.startLine) : undefined;
  return {
    path,
    line,
    // A range that starts after it ends, or on the line it ends, is not a range.
    ...(start !== undefined && start >= 1 && start < line ? { startLine: start } : {}),
    body,
  };
}

/**
 * Lenient about the wrapper and strict about the contents.
 *
 * An agent that answered in prose is taken at its word and gets a review with
 * no anchors, which is what Loopable did before it could anchor anything. An
 * agent that plainly meant to answer in JSON, by fencing it as such, and
 * produced nothing readable is an error: the alternative is posting the
 * wreckage to somebody's pull request.
 */
export function parseReview(text: string): ReviewAnswer {
  const { labelled, rest } = jsonCandidates(text);
  for (const candidate of [...labelled, ...rest]) {
    const answer = answerFrom(candidate);
    if (answer) return answer;
  }

  if (labelled.length > 0) {
    throw new Error("The agent was asked for JSON and produced something that could not be read.");
  }
  const summary = text.trim();
  if (!summary) throw new Error("The agent's answer was empty.");
  return { summary, findings: [] };
}

/**
 * Splits findings into the ones that can be attached to a line and the ones
 * that cannot. With nothing to check against, everything is treated as
 * unanchorable: guessing would risk the whole review being refused.
 */
export function anchorFindings(
  findings: Finding[],
  commentable: Commentable | undefined,
): { comments: Finding[]; loose: Finding[] } {
  const comments: Finding[] = [];
  const loose: Finding[] = [];

  for (const finding of findings) {
    const lines = commentable?.[finding.path];
    const allowed = lines ? new Set(lines) : null;
    const fits =
      allowed !== null &&
      allowed.has(finding.line) &&
      (finding.startLine === undefined || allowed.has(finding.startLine));
    (fits ? comments : loose).push(finding);
  }
  return { comments, loose };
}

/** The review body: the overview, then anything that could not be anchored. */
export function reviewBody(summary: string, loose: Finding[]): string {
  const parts = summary ? [summary] : [];
  for (const finding of loose) {
    const at = finding.startLine ? `${finding.startLine}-${finding.line}` : String(finding.line);
    parts.push(`**${finding.path}:${at}**\n\n${finding.body}`);
  }
  return parts.join("\n\n");
}
