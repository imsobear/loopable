import assert from "node:assert/strict";
import { test } from "node:test";
import { matchRule } from "../src/engine/rules.ts";
import type { NormalizedEvent } from "../src/github/map-notification.ts";
import type { Rule } from "../src/engine/rules.ts";

const reviewEvent: NormalizedEvent = {
  id: "github:acme/web:pr:456:review_requested:n1",
  connector: "github",
  type: "pull_request.review_requested_of_me",
  occurredAt: "2026-09-02T12:00:00Z",
  workItemId: "github/acme/web/pull/456/reviewer",
  wakeRef: { notificationId: "n1" },
  payload: {
    repository: "acme/web",
    number: 456,
    title: "Add rate limit",
    subjectType: "PullRequest",
    reason: "review_requested",
    url: "https://api.github.com/repos/acme/web/pulls/456",
    draft: false,
  },
};

const reviewRule: Rule = {
  id: "review-requested",
  name: "Review requested PR",
  enabled: true,
  trigger: { connector: "github", event: "pull_request.review_requested_of_me" },
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
};

test("matches enabled rule for the same event type", () => {
  const rule = matchRule([reviewRule], reviewEvent);
  assert.equal(rule?.id, "review-requested");
});

test("skips draft pull requests when ignore_drafts is set", () => {
  const draft = {
    ...reviewEvent,
    payload: { ...reviewEvent.payload, draft: true },
  };
  const rule = matchRule([reviewRule], draft);
  assert.equal(rule, null);
});

test("does not match a different event type", () => {
  const assigned = {
    ...reviewEvent,
    type: "issue.assigned_to_me",
  };
  const rule = matchRule([reviewRule], assigned);
  assert.equal(rule, null);
});
