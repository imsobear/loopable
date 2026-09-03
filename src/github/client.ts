export type GithubClient = {
  token: string;
  login: string;
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

export async function createGithubClient(token: string): Promise<GithubClient> {
  const login = await request<{ login: string }>(token, "/user");
  return {
    token,
    login: login.login,
    request: (path, init) => request(token, path, init),
  };
}

async function request<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (res.status === 304) {
    return [] as T;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type NotificationRow = {
  id: string;
  reason: string;
  updated_at: string;
  unread: boolean;
  subject: {
    type: string;
    title: string;
    url: string | null;
    latest_comment_url: string | null;
  };
  repository: { full_name: string };
};

export type SearchIssueRow = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  pull_request?: { url?: string } | null;
  repository_url: string;
  draft?: boolean;
};

export async function searchIssues(
  client: GithubClient,
  q: string,
): Promise<SearchIssueRow[]> {
  const qs = new URLSearchParams({ q, per_page: "50" });
  const res = await client.request<{ items?: SearchIssueRow[] }>(`/search/issues?${qs.toString()}`);
  return res.items ?? [];
}

export async function listNotifications(
  client: GithubClient,
  since?: string,
): Promise<{ items: NotificationRow[]; lastModified?: string }> {
  const qs = new URLSearchParams({
    participating: "true",
    all: "false",
    per_page: "50",
  });
  if (since) qs.set("since", since);
  const items = await client.request<NotificationRow[]>(
    `/notifications?${qs.toString()}`,
  );
  return { items: items ?? [] };
}

export type PullDetail = {
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  html_url: string;
  user: { login: string };
  head: { sha: string; ref: string };
  base: { ref: string };
};

export async function getPull(
  client: GithubClient,
  repo: string,
  number: number,
): Promise<PullDetail> {
  return client.request<PullDetail>(`/repos/${repo}/pulls/${number}`);
}

export async function getIssue(
  client: GithubClient,
  repo: string,
  number: number,
): Promise<{ number: number; title: string; body: string | null; html_url: string; user: { login: string } }> {
  return client.request(`/repos/${repo}/issues/${number}`);
}

export async function listPullFiles(
  client: GithubClient,
  repo: string,
  number: number,
): Promise<Array<{ filename: string; status: string; patch?: string }>> {
  return client.request(`/repos/${repo}/pulls/${number}/files?per_page=30`);
}

export async function submitReview(
  client: GithubClient,
  owner: string,
  repo: string,
  pull: number,
  body: string,
): Promise<{ id: number }> {
  return client.request(`/repos/${owner}/${repo}/pulls/${pull}/reviews`, {
    method: "POST",
    body: JSON.stringify({ event: "COMMENT", body }),
  });
}

export async function postIssueComment(
  client: GithubClient,
  owner: string,
  repo: string,
  issue: number,
  body: string,
): Promise<{ id: number }> {
  return client.request(`/repos/${owner}/${repo}/issues/${issue}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
