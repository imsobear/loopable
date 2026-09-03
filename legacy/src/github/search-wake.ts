import type { NormalizedEvent } from "./map-notification.ts";

export type SearchIssue = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  pull_request?: { url?: string } | null;
  repository_url: string;
  draft?: boolean;
};

export function repoFromRepositoryUrl(url: string): string {
  const match = url.match(/\/repos\/([^/]+\/[^/?]+)/);
  return match ? match[1] : "";
}

export function mapSearchWake(
  item: SearchIssue,
  kind: "review_requested" | "assign" | "author_comment",
): NormalizedEvent | null {
  const repository = repoFromRepositoryUrl(item.repository_url);
  if (!repository) return null;
  const isPr = Boolean(item.pull_request) || kind !== "assign";
  const number = item.number;
  if (kind === "review_requested") {
    return {
      id: `github:${repository}:pr:${number}:review_requested:${item.id}`,
      connector: "github",
      type: "pull_request.review_requested_of_me",
      occurredAt: item.updated_at,
      workItemId: `github/${repository}/pull/${number}/reviewer`,
      wakeRef: { notificationId: String(item.id) },
      payload: {
        repository,
        number,
        title: item.title,
        subjectType: "PullRequest",
        reason: "review_requested",
        url: item.html_url,
        draft: item.draft ?? false,
      },
    };
  }
  if (kind === "assign") {
    return {
      id: `github:${repository}:issue:${number}:assign:${item.id}`,
      connector: "github",
      type: "issue.assigned_to_me",
      occurredAt: item.updated_at,
      workItemId: `github/${repository}/${isPr ? "pull" : "issues"}/${number}/assignee`,
      wakeRef: { notificationId: String(item.id) },
      payload: {
        repository,
        number,
        title: item.title,
        subjectType: isPr ? "PullRequest" : "Issue",
        reason: "assign",
        url: item.html_url,
        draft: item.draft ?? false,
      },
    };
  }
  return {
    id: `github:${repository}:pr:${number}:comment:${item.updated_at}`,
    connector: "github",
    type: "pull_request.review_or_comment_on_mine",
    occurredAt: item.updated_at,
    workItemId: `github/${repository}/pull/${number}/author`,
    wakeRef: { notificationId: String(item.id) },
    payload: {
      repository,
      number,
      title: item.title,
      subjectType: "PullRequest",
      reason: "comment",
      url: item.html_url,
      draft: item.draft ?? false,
    },
  };
}
