import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../src/db.ts";
import { ingestEvent } from "../src/engine/ingest.ts";
import { approveRun, rejectRun, transition } from "../src/engine/runs.ts";
import type { NormalizedEvent } from "../src/github/map-notification.ts";
import { defaultRules } from "../src/engine/default-rules.ts";

function sampleEvent(id = "github:acme/web:pr:456:review_requested:n1"): NormalizedEvent {
  return {
    id,
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
}

test("ingest creates a work item and queued run", () => {
  const db = openDb(":memory:");
  const result = ingestEvent(db, sampleEvent(), defaultRules());
  assert.equal(result.created, true);
  assert.equal(result.run?.state, "queued");
  assert.equal(result.run?.work_item_id, "github/acme/web/pull/456/reviewer");
});

test("duplicate event id does not create a second run", () => {
  const db = openDb(":memory:");
  ingestEvent(db, sampleEvent(), defaultRules());
  const again = ingestEvent(db, sampleEvent(), defaultRules());
  assert.equal(again.created, false);
  const runs = db.prepare("select count(*) as c from runs").get() as { c: number };
  assert.equal(runs.c, 1);
});

test("approve marks proposed op applied and run completed", () => {
  const db = openDb(":memory:");
  const { run } = ingestEvent(db, sampleEvent(), defaultRules());
  assert.ok(run);
  transition(db, run.id, "running");
  transition(db, run.id, "needs_approval", {
    summary: "Looks good with one test gap.",
    proposedOp: {
      type: "github.submit_review",
      owner: "acme",
      repo: "web",
      pull: 456,
      event: "COMMENT",
      body: "Add a test for 429.",
    },
  });
  const updated = approveRun(db, run.id, { externalId: "review-1" });
  assert.equal(updated.state, "completed");
  assert.equal(updated.outcome, "published");
});

test("reject leaves GitHub untouched and completes with rejected", () => {
  const db = openDb(":memory:");
  const { run } = ingestEvent(db, sampleEvent(), defaultRules());
  assert.ok(run);
  transition(db, run.id, "running");
  transition(db, run.id, "needs_approval", {
    proposedOp: {
      type: "github.submit_review",
      owner: "acme",
      repo: "web",
      pull: 456,
      event: "COMMENT",
      body: "nits",
    },
  });
  const updated = rejectRun(db, run.id);
  assert.equal(updated.state, "completed");
  assert.equal(updated.outcome, "rejected");
});
