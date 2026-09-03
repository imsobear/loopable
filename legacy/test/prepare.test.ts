import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../src/db.ts";
import { ingestEvent } from "../src/engine/ingest.ts";
import { defaultRules } from "../src/engine/default-rules.ts";
import { prepareRun } from "../src/engine/prepare.ts";
import { getRun } from "../src/engine/runs.ts";
import type { NormalizedEvent } from "../src/github/map-notification.ts";

const ENV_KEYS = ["GITHUB_TOKEN", "LOOPABLE_RUNNER", "LOOPABLE_HOME", "LOOPABLE_KEYCHAIN"] as const;

// Without this the run would read the developer's own Keychain session and call
// live GitHub, so the suite would pass or fail depending on who ran it.
async function withoutRealCredentials(
  env: { githubToken?: string },
  fn: () => Promise<void>,
): Promise<void> {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  const dir = mkdtempSync(join(tmpdir(), "loopable-prepare-"));
  process.env.LOOPABLE_HOME = dir;
  process.env.LOOPABLE_KEYCHAIN = "0";
  process.env.LOOPABLE_RUNNER = "loopable-no-runner";
  if (env.githubToken) process.env.GITHUB_TOKEN = env.githubToken;
  else delete process.env.GITHUB_TOKEN;
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function reviewRequest(repo: string, number: number, title: string): NormalizedEvent {
  return {
    id: `github:${repo}:pr:${number}:review_requested:x`,
    connector: "github",
    type: "pull_request.review_requested_of_me",
    occurredAt: new Date().toISOString(),
    workItemId: `github/${repo}/pull/${number}/reviewer`,
    wakeRef: { notificationId: "x" },
    payload: {
      repository: repo,
      number,
      title,
      subjectType: "PullRequest",
      reason: "review_requested",
      url: `https://github.com/${repo}/pull/${number}`,
      draft: false,
    },
  };
}

test("prepare without GitHub token still yields a review that needs approval", async () => {
  await withoutRealCredentials({}, async () => {
    const db = openDb(":memory:");
    const { run } = ingestEvent(db, reviewRequest("acme/web", 9, "Add timeout"), defaultRules());
    assert.ok(run);
    await prepareRun(db, run.id);
    assert.equal(getRun(db, run.id).state, "needs_approval");
    const op = db
      .prepare("select op_json from proposed_ops where run_id = ?")
      .get(run.id) as { op_json: string };
    const parsed = JSON.parse(op.op_json);
    assert.equal(parsed.type, "github.submit_review");
    assert.match(parsed.body, /Prepared with local agent/);
    assert.doesNotMatch(parsed.body, /GITHUB_TOKEN/);
  });
});

test("demo fixtures are never hydrated from GitHub, even when connected", async () => {
  await withoutRealCredentials({ githubToken: "gho_not_a_real_token" }, async () => {
    const db = openDb(":memory:");
    const { run } = ingestEvent(
      db,
      reviewRequest("demo/web", 1, "Demo: add rate limit"),
      defaultRules(),
    );
    assert.ok(run);
    await prepareRun(db, run.id);
    assert.equal(getRun(db, run.id).state, "needs_approval");
  });
});
