import type { WorkItem } from "../types.ts";
import { getIssue, getPull, listPullFiles, type PullFile } from "./api.ts";

/** Accepts what a person actually copies out of the address bar. */
export function parseGithubUrl(
  input: string,
): { repo: string; kind: "pull_request" | "issue"; number: number } | null {
  const match = input
    .trim()
    .match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(pull|issues)\/(\d+)/i);
  if (!match) return null;
  const [, owner, name, kind, number] = match;
  return {
    repo: `${owner}/${name}`,
    kind: kind.toLowerCase() === "pull" ? "pull_request" : "issue",
    number: Number(number),
  };
}

/**
 * Generous, because a review written against half a diff is worse than no
 * review: the agent hedges everything it could not see. Where a cut is
 * unavoidable it is announced, so the agent knows to stay quiet about the rest
 * instead of guessing.
 */
const PER_FILE_LIMIT = 24_000;
const TOTAL_LIMIT = 120_000;

function patchOf(file: PullFile, budget: number): string {
  const patch = file.patch;
  if (!patch) {
    return file.status === "renamed" ? "_Renamed, no content change._" : "_No diff available._";
  }
  const limit = Math.min(PER_FILE_LIMIT, budget);
  if (patch.length <= limit) return `\`\`\`diff\n${patch}\n\`\`\``;

  const kept = patch.slice(0, limit);
  const cutAtLine = kept.slice(0, kept.lastIndexOf("\n"));
  const droppedLines = patch.slice(cutAtLine.length).split("\n").length;
  return [
    `\`\`\`diff\n${cutAtLine}\n\`\`\``,
    `**The diff for this file was cut here: ${droppedLines} more lines are not shown. Do not draw conclusions about the part you cannot see.**`,
  ].join("\n\n");
}

function diffOf(files: PullFile[]): string {
  const sections: string[] = [];
  let budget = TOTAL_LIMIT;
  let shown = 0;

  for (const file of files) {
    if (budget <= 0) break;
    const counts = [
      file.additions === undefined ? null : `+${file.additions}`,
      file.deletions === undefined ? null : `-${file.deletions}`,
    ]
      .filter(Boolean)
      .join(" ");
    const body = patchOf(file, budget);
    sections.push(`### ${file.filename}\n\n${file.status}${counts ? ` ${counts}` : ""}\n\n${body}`);
    budget -= body.length;
    shown += 1;
  }

  const omitted = files.length - shown;
  if (omitted > 0) {
    sections.push(
      `**${omitted} more changed files are not shown at all: ${files
        .slice(shown)
        .map((file) => file.filename)
        .join(", ")}**`,
    );
  }
  return sections.join("\n\n");
}

/**
 * Everything the agent is allowed to know about the work, written to files it
 * can read. No clone and no token: the diff comes down through the API.
 */
export async function resolveWorkItem(url: string, accessToken: string): Promise<WorkItem> {
  const parsed = parseGithubUrl(url);
  if (!parsed) {
    throw new Error("That does not look like a GitHub pull request or issue link.");
  }

  if (parsed.kind === "pull_request") {
    const pull = await getPull(accessToken, parsed.repo, parsed.number);
    const files = await listPullFiles(accessToken, parsed.repo, parsed.number);
    return {
      kind: "pull_request",
      repo: parsed.repo,
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      context: [
        {
          name: "PULL_REQUEST.md",
          body: [
            `# ${pull.title}`,
            ``,
            `Repository: ${parsed.repo}`,
            `Pull request: #${pull.number}`,
            `Opened by: ${pull.user.login}`,
            `Draft: ${pull.draft ? "yes" : "no"}`,
            `URL: ${pull.html_url}`,
            ``,
            `## Description`,
            ``,
            pull.body?.trim() || "_No description._",
          ].join("\n"),
        },
        { name: "CHANGES.md", body: diffOf(files) || "_No file changes returned._" },
      ],
    };
  }

  const issue = await getIssue(accessToken, parsed.repo, parsed.number);
  return {
    kind: "issue",
    repo: parsed.repo,
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    context: [
      {
        name: "ISSUE.md",
        body: [
          `# ${issue.title}`,
          ``,
          `Repository: ${parsed.repo}`,
          `Issue: #${issue.number}`,
          `Opened by: ${issue.user.login}`,
          `URL: ${issue.html_url}`,
          ``,
          `## Description`,
          ``,
          issue.body?.trim() || "_No description._",
        ].join("\n"),
      },
    ],
  };
}
