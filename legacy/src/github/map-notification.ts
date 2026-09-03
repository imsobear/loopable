export type GithubSubject = {
  type: string;
  title: string;
  url: string;
  latest_comment_url?: string | null;
};

export type GithubNotification = {
  id: string;
  reason: string;
  updated_at: string;
  subject: GithubSubject;
  repository: { full_name: string };
};

export type GithubUser = { login: string };

export type NormalizedEvent = {
  id: string;
  connector: "github";
  type: string;
  occurredAt: string;
  workItemId: string;
  wakeRef: { notificationId: string };
  payload: {
    repository: string;
    number: number;
    title: string;
    subjectType: string;
    reason: string;
    url: string;
    draft?: boolean;
  };
};

function parseNumber(url: string): number | null {
  const match = url.match(/\/(issues|pulls|pull)\/(\d+)/);
  return match ? Number(match[2]) : null;
}

function prNumberFromRelated(url: string | null | undefined): number | null {
  if (!url) return null;
  return parseNumber(url);
}

export function mapNotification(
  n: GithubNotification,
  _me: GithubUser,
): NormalizedEvent | null {
  const repo = n.repository.full_name;
  const number =
    parseNumber(n.subject.url) ??
    prNumberFromRelated(n.subject.latest_comment_url);
  if (!number) return null;

  const isPr =
    n.subject.type === "PullRequest" ||
    n.subject.type === "CheckSuite" ||
    /\/pulls\/\d+/.test(n.subject.url) ||
    /\/pulls\/\d+/.test(n.subject.latest_comment_url ?? "");

  let type: string | null = null;
  let role: "assignee" | "reviewer" | "author" = "assignee";

  if (n.reason === "review_requested" && isPr) {
    type = "pull_request.review_requested_of_me";
    role = "reviewer";
  } else if (n.reason === "assign" && !isPr) {
    type = "issue.assigned_to_me";
    role = "assignee";
  } else if (
    n.reason === "assign" &&
    isPr
  ) {
    type = "issue.assigned_to_me";
    role = "assignee";
  } else if (
    (n.reason === "review_requested" ||
      n.reason === "comment" ||
      n.reason === "mention" ||
      n.reason === "author") &&
    isPr &&
    n.reason !== "review_requested"
  ) {
    type = "pull_request.review_or_comment_on_mine";
    role = "author";
  } else if (n.reason === "author" && isPr) {
    type = "pull_request.review_or_comment_on_mine";
    role = "author";
  } else if (n.reason === "ci_activity") {
    type = "check_suite.completed_on_mine";
    role = "author";
  }

  if (n.reason === "comment" && isPr) {
    type = "pull_request.review_or_comment_on_mine";
    role = "author";
  }

  if (!type) return null;

  const kind = isPr || type.startsWith("pull_request") || type.startsWith("check_suite")
    ? "pr"
    : "issues";
  const workKind = kind === "pr" ? "pull" : "issues";
  const changeKind =
    n.reason === "review_requested"
      ? "review_requested"
      : n.reason === "assign"
        ? "assign"
        : n.reason === "ci_activity"
          ? "ci"
          : n.reason;

  return {
    id: `github:${repo}:${kind === "pr" ? "pr" : "issue"}:${number}:${changeKind}:${n.id}`,
    connector: "github",
    type,
    occurredAt: n.updated_at,
    workItemId: `github/${repo}/${workKind}/${number}/${role}`,
    wakeRef: { notificationId: n.id },
    payload: {
      repository: repo,
      number,
      title: n.subject.title,
      subjectType: n.subject.type,
      reason: n.reason,
      url: n.subject.url,
      draft: false,
    },
  };
}
