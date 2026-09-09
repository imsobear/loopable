import type { Commentable } from "#/lib/review.ts";
import type { WorkItem } from "../types.ts";
import { getIssue, getPull, listPullFiles, type PullFile } from "./api.ts";
import { ANNOTATION_LEGEND, annotate } from "./diff.ts";

const HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * Accepts what a person actually copies out of the address bar, and checks the
 * host properly: matching "github.com" anywhere in the text would accept
 * https://notgithub.com/acme/web/pull/1 and then go and fetch acme/web from
 * the real GitHub.
 */
export function parseGithubUrl(
  input: string,
): { repo: string; kind: "pull_request" | "issue"; number: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
  if (!match) return null;
  const [, owner, name, kind, number] = match;
  return {
    repo: `${owner}/${name}`,
    kind: kind === "pull" ? "pull_request" : "issue",
    number: Number(number),
  };
}

/** How GitHub names a thing everywhere outside itself: `owner/name#12`. */
export function githubRef(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/**
 * The other direction, for the point where a write has to name a repository
 * and a number again. Throws rather than returns null: a ref that this
 * connector wrote and cannot read back is a bug, not a bad input.
 */
export function parseGithubRef(ref: string): { repo: string; number: number } {
  const match = ref.match(/^([^/\s]+\/[^/\s#]+)#(\d+)$/);
  if (!match) throw new Error(`Not a GitHub ref: ${ref}`);
  return { repo: match[1], number: Number(match[2]) };
}

/**
 * Generous, because a review written against half a diff is worse than no
 * review: the agent hedges everything it could not see. Nothing is cut while
 * the whole diff fits, and where a cut is unavoidable it is announced, so the
 * agent knows to stay quiet about the rest instead of guessing.
 */
const TOTAL_LIMIT = 200_000;
/** No file is cut below this, however many files there are. */
const MIN_PER_FILE = 8_000;

/**
 * A file's patch as the agent sees it, and the lines it may comment on. A cut
 * patch keeps only the anchors that are still visible: a comment on a line the
 * agent was never shown would be a guess.
 */
function patchOf(file: PullFile, budget: number): { body: string; lines: number[] } {
  const patch = file.patch;
  if (!patch) {
    return {
      body: file.status === "renamed" ? "_Renamed, no content change._" : "_No diff available._",
      lines: [],
    };
  }

  const whole = patch.length <= budget ? patch : patch.slice(0, patch.lastIndexOf("\n", budget));
  const { text, lines } = annotate(whole);
  const block = `\`\`\`diff\n${text}\n\`\`\``;
  if (patch.length <= budget) return { body: block, lines };

  const droppedLines = patch.slice(whole.length).split("\n").length;
  return {
    body: [
      block,
      `**The diff for this file was cut here: ${droppedLines} more lines are not shown. Do not draw conclusions about the part you cannot see.**`,
    ].join("\n\n"),
    lines,
  };
}

function diffOf(files: PullFile[]): { body: string; commentable: Commentable } {
  const total = files.reduce((sum, file) => sum + (file.patch?.length ?? 0), 0);
  // A fair share only comes into play once the whole diff cannot fit, so the
  // common case of a normal-sized pull request arrives complete.
  const share =
    total <= TOTAL_LIMIT
      ? Number.POSITIVE_INFINITY
      : Math.max(MIN_PER_FILE, Math.floor(TOTAL_LIMIT / files.length));

  const sections: string[] = [ANNOTATION_LEGEND];
  const commentable: Commentable = {};
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
    const { body, lines } = patchOf(file, Math.min(share, budget));
    sections.push(`### ${file.filename}\n\n${file.status}${counts ? ` ${counts}` : ""}\n\n${body}`);
    if (lines.length > 0) commentable[file.filename] = lines;
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
  return { body: sections.join("\n\n"), commentable };
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
    const diff = diffOf(files);
    return {
      kind: "pull_request",
      commentable: diff.commentable,
      ref: githubRef(parsed.repo, pull.number),
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
        { name: "CHANGES.md", body: diff.body || "_No file changes returned._" },
      ],
    };
  }

  const issue = await getIssue(accessToken, parsed.repo, parsed.number);
  return {
    kind: "issue",
    ref: githubRef(parsed.repo, issue.number),
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
