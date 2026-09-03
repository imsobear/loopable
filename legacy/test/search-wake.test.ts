import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSearchWake, repoFromRepositoryUrl } from "../src/github/search-wake.ts";

test("parses owner/repo from a GitHub API repository URL", () => {
  assert.equal(
    repoFromRepositoryUrl("https://api.github.com/repos/acme/web"),
    "acme/web",
  );
});

test("search review-requested maps to reviewer work item", () => {
  const event = mapSearchWake(
    {
      id: 99,
      number: 456,
      title: "Add rate limit",
      html_url: "https://github.com/acme/web/pull/456",
      updated_at: "2026-09-02T12:00:00Z",
      pull_request: { url: "https://api.github.com/repos/acme/web/pulls/456" },
      repository_url: "https://api.github.com/repos/acme/web",
      draft: false,
    },
    "review_requested",
  );
  assert.equal(event?.type, "pull_request.review_requested_of_me");
  assert.equal(event?.workItemId, "github/acme/web/pull/456/reviewer");
});

test("search assigned issue maps to assignee work item", () => {
  const event = mapSearchWake(
    {
      id: 12,
      number: 12,
      title: "Rate limit login",
      html_url: "https://github.com/acme/web/issues/12",
      updated_at: "2026-09-02T12:00:00Z",
      pull_request: null,
      repository_url: "https://api.github.com/repos/acme/web",
    },
    "assign",
  );
  assert.equal(event?.type, "issue.assigned_to_me");
  assert.equal(event?.workItemId, "github/acme/web/issues/12/assignee");
});
