import { TransientError } from "../errors.ts";

async function request<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "loopable",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
  } catch (error) {
    throw new TransientError(
      `GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    const message = `GitHub ${res.status} on ${path}: ${detail}`;
    // A 403 is usually a permission problem, which will never fix itself, but
    // GitHub also uses it for secondary rate limits, which will.
    const rateLimited = res.status === 403 && /rate limit|abuse|try again/i.test(detail);
    if (res.status === 429 || res.status >= 500 || rateLimited) throw new TransientError(message);
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export type PullRequest = {
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  html_url: string;
  user: { login: string };
  head: { sha: string };
  changed_files: number;
};

export type Issue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string };
  pull_request?: unknown;
};

export type PullFile = {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

export function getPull(accessToken: string, repo: string, number: number): Promise<PullRequest> {
  return request<PullRequest>(accessToken, `/repos/${repo}/pulls/${number}`);
}

export function getIssue(accessToken: string, repo: string, number: number): Promise<Issue> {
  return request<Issue>(accessToken, `/repos/${repo}/issues/${number}`);
}

export function listPullFiles(
  accessToken: string,
  repo: string,
  number: number,
): Promise<PullFile[]> {
  return request<PullFile[]>(accessToken, `/repos/${repo}/pulls/${number}/files?per_page=100`);
}

/**
 * One search result. Search returns issue-shaped items even for pull
 * requests, which is why the repository has to be read back out of the URL and
 * why anything specific to a pull request needs a second request.
 */
export type SearchItem = {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  draft?: boolean;
  user: { login: string; type?: string };
  pull_request?: unknown;
};

/**
 * Search is capped at one page on purpose. A hundred things waiting on you is
 * already past the point where running an agent on all of them is the right
 * answer, and paginating would only make a bad situation more expensive.
 */
export async function searchIssues(accessToken: string, query: string): Promise<SearchItem[]> {
  const path = `/search/issues?q=${encodeURIComponent(query)}&per_page=100&advanced_search=true`;
  const result = await request<{ items: SearchItem[] }>(accessToken, path);
  return result.items;
}

/** One comment attached to a line of the diff, on the new side of it. */
export type ReviewComment = {
  path: string;
  line: number;
  start_line?: number;
  side: "RIGHT";
  start_side?: "RIGHT";
  body: string;
};

/**
 * Reviews are submitted as COMMENT, never APPROVE: a rule may say what it
 * thinks, but whether a pull request is approved stays a human judgement.
 *
 * A comment on a line outside the diff makes GitHub refuse the whole review,
 * so callers check their anchors before getting here.
 */
export function submitReview(
  accessToken: string,
  repo: string,
  pull: number,
  body: string,
  comments: ReviewComment[] = [],
): Promise<{ html_url: string }> {
  return request<{ html_url: string }>(accessToken, `/repos/${repo}/pulls/${pull}/reviews`, {
    method: "POST",
    body: JSON.stringify({
      event: "COMMENT",
      body,
      ...(comments.length > 0 ? { comments } : {}),
    }),
  });
}

export function postIssueComment(
  accessToken: string,
  repo: string,
  issue: number,
  body: string,
): Promise<{ html_url: string }> {
  return request<{ html_url: string }>(accessToken, `/repos/${repo}/issues/${issue}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export type GithubUser = {
  login: string;
  id: number;
  html_url: string;
  avatar_url: string;
};

export async function getViewer(
  accessToken: string,
): Promise<{ user: GithubUser; scopes: string[] }> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "loopable",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} on /user: ${(await res.text()).slice(0, 200)}`);
  }
  const user = (await res.json()) as GithubUser;
  const scopes = (res.headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return { user, scopes };
}
