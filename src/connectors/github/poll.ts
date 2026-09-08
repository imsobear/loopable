import type { Signal } from "../types.ts";
import { getPull, searchIssues, type SearchItem } from "./api.ts";

/**
 * Search tells you which repository a result came from only through its API
 * URL, so the owner and name are read back out of it.
 */
export function repoFromApiUrl(url: string): string | null {
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/.exec(url);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** An empty list means every repository the account can see. */
export function repoMatches(repo: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  const target = repo.toLowerCase();
  return patterns.some((pattern) => {
    const escaped = pattern
      .trim()
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      // A star stands for one path segment, so acme/* cannot reach past the
      // owner it names.
      .replace(/\*/g, "[^/]*");
    return escaped !== "" && new RegExp(`^${escaped}$`).test(target);
  });
}

/** Apps get a login ending in [bot]; the type is set for both apps and users. */
export function isBot(user: { login: string; type?: string }): boolean {
  return user.type === "Bot" || user.login.endsWith("[bot]");
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Missing means "the workflow's default", not "off". A rule saved before a
 * setting existed must behave as if it had been there all along.
 */
function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function count(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

type Candidate = { repo: string; item: SearchItem };

function candidates(items: SearchItem[], repositories: string[]): Candidate[] {
  return items.flatMap((item) => {
    const repo = repoFromApiUrl(item.repository_url);
    return repo && repoMatches(repo, repositories) ? [{ repo, item }] : [];
  });
}

export async function pollGithub(input: {
  workflowId: string;
  settings: Record<string, unknown>;
  accessToken: string;
}): Promise<Signal[]> {
  const repositories = stringList(input.settings.repositories);

  if (input.workflowId === "github.review_requested") {
    // Covers requests addressed to a team as well as to the person, and
    // empties itself: once a review is submitted, GitHub drops the request.
    const items = await searchIssues(input.accessToken, "is:open is:pr review-requested:@me");
    const ignoreDrafts = boolean(input.settings.ignoreDrafts, true);
    const ignoreBots = boolean(input.settings.ignoreBots, true);
    const maxFiles = count(input.settings.maxChangedFiles, 50);

    const signals: Signal[] = [];
    for (const { repo, item } of candidates(items, repositories)) {
      // Everything answerable from the search result is answered first, so a
      // skipped pull request costs nothing.
      if (ignoreBots && isBot(item.user)) continue;
      if (ignoreDrafts && item.draft) continue;

      // The head commit is what makes the key change when there is something
      // new to review, and search does not carry it.
      const pull = await getPull(input.accessToken, repo, item.number);
      if (ignoreDrafts && pull.draft) continue;
      if (maxFiles > 0 && pull.changed_files > maxFiles) continue;

      signals.push({
        key: `${repo}#${item.number}@${pull.head.sha}`,
        kind: "pull_request",
        repo,
        number: item.number,
        title: item.title,
        url: item.html_url,
      });
    }
    return signals;
  }

  if (input.workflowId === "github.issue_assigned") {
    const items = await searchIssues(input.accessToken, "is:open is:issue assignee:@me");
    // One plan per issue: being assigned again, or the issue being edited, is
    // not a reason to write a second one.
    return candidates(items, repositories).map(({ repo, item }) => ({
      key: `${repo}#${item.number}`,
      kind: "issue" as const,
      repo,
      number: item.number,
      title: item.title,
      url: item.html_url,
    }));
  }

  throw new Error(`GitHub cannot watch for ${input.workflowId}.`);
}
