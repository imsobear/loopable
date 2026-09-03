import type { Db } from "../db.ts";
import type { Rule } from "./rules.ts";

export function defaultRules(): Rule[] {
  return [
    {
      id: "review-requested",
      name: "Review requested PR",
      enabled: true,
      trigger: {
        connector: "github",
        event: "pull_request.review_requested_of_me",
      },
      filters: { repositories: ["*/*"], ignore_drafts: true },
      action: {
        type: "review_pull_request",
        instructions: "Focus on correctness, security, and missing tests.",
      },
      execution: {
        runner: "codex",
        workspace: "temporary_read_only",
        timeout: "30m",
      },
      publishing: { mode: "require_approval", destination: "github_review" },
    },
    {
      id: "issue-assigned",
      name: "Issue assigned to me",
      enabled: true,
      trigger: { connector: "github", event: "issue.assigned_to_me" },
      filters: { repositories: ["*/*"] },
      action: {
        type: "prepare_issue_plan",
        instructions: "Write a short implementation plan. Do not write code.",
      },
      execution: {
        runner: "codex",
        workspace: "repo_read_only",
        timeout: "30m",
      },
      publishing: { mode: "require_approval", destination: "github_issue_comment" },
    },
    {
      id: "pr-comments-on-mine",
      name: "Review comments on my PR",
      enabled: true,
      trigger: {
        connector: "github",
        event: "pull_request.review_or_comment_on_mine",
      },
      filters: { repositories: ["*/*"] },
      action: {
        type: "address_review_comments",
        instructions: "Address the review comments. Keep the diff small.",
      },
      execution: {
        runner: "codex",
        workspace: "persistent_worktree",
        timeout: "30m",
      },
      publishing: { mode: "require_approval", destination: "github_push" },
    },
    {
      id: "ci-on-mine",
      name: "CI completed on my PR",
      enabled: true,
      trigger: { connector: "github", event: "check_suite.completed_on_mine" },
      filters: { repositories: ["*/*"] },
      action: {
        type: "investigate_ci_failure",
        instructions: "If CI failed, explain the failure and propose a fix.",
      },
      execution: {
        runner: "codex",
        workspace: "persistent_worktree",
        timeout: "30m",
      },
      publishing: { mode: "require_approval", destination: "github_issue_comment" },
    },
  ];
}

export function loadRules(db: Db): Rule[] {
  const rows = db.prepare("select json from rules").all() as Array<{ json: string }>;
  if (rows.length === 0) {
    for (const rule of defaultRules()) {
      db.prepare("insert into rules (id, enabled, json) values (?, 1, ?)").run(
        rule.id,
        JSON.stringify(rule),
      );
    }
    return defaultRules();
  }
  return rows.map((r) => JSON.parse(r.json) as Rule);
}
