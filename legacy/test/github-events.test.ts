import assert from "node:assert/strict";
import { test } from "node:test";
import { mapNotification } from "../src/github/map-notification.ts";

test("review_requested on a pull request maps to reviewer work item", () => {
  const event = mapNotification(
    {
      id: "n1",
      reason: "review_requested",
      updated_at: "2026-09-02T12:00:00Z",
      subject: {
        type: "PullRequest",
        title: "Add rate limit",
        url: "https://api.github.com/repos/acme/web/pulls/456",
      },
      repository: { full_name: "acme/web" },
    },
    { login: "eric" },
  );
  assert.equal(event?.type, "pull_request.review_requested_of_me");
  assert.equal(event?.workItemId, "github/acme/web/pull/456/reviewer");
  assert.equal(
    event?.id,
    "github:acme/web:pr:456:review_requested:n1",
  );
});

test("assign on an issue maps to assignee work item", () => {
  const event = mapNotification(
    {
      id: "n2",
      reason: "assign",
      updated_at: "2026-09-02T12:00:00Z",
      subject: {
        type: "Issue",
        title: "Rate limit login",
        url: "https://api.github.com/repos/acme/web/issues/12",
      },
      repository: { full_name: "acme/web" },
    },
    { login: "eric" },
  );
  assert.equal(event?.type, "issue.assigned_to_me");
  assert.equal(event?.workItemId, "github/acme/web/issues/12/assignee");
});

test("ci_activity on my pull request maps to check completed", () => {
  const event = mapNotification(
    {
      id: "n3",
      reason: "ci_activity",
      updated_at: "2026-09-02T12:00:00Z",
      subject: {
        type: "CheckSuite",
        title: "ci",
        url: "https://api.github.com/repos/acme/web/check-suites/1",
        latest_comment_url:
          "https://api.github.com/repos/acme/web/pulls/456",
      },
      repository: { full_name: "acme/web" },
    },
    { login: "eric" },
  );
  assert.equal(event?.type, "check_suite.completed_on_mine");
  assert.equal(event?.workItemId, "github/acme/web/pull/456/author");
});

test("unrelated subscribed notification is ignored", () => {
  const event = mapNotification(
    {
      id: "n4",
      reason: "subscribed",
      updated_at: "2026-09-02T12:00:00Z",
      subject: {
        type: "Issue",
        title: "noise",
        url: "https://api.github.com/repos/acme/web/issues/99",
      },
      repository: { full_name: "acme/web" },
    },
    { login: "eric" },
  );
  assert.equal(event, null);
});
