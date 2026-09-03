import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOp } from "../src/github/publisher.ts";

test("demo ops apply locally without a GitHub client", async () => {
  const result = await applyOp(null, {
    type: "github.submit_review",
    owner: "demo",
    repo: "web",
    pull: 1,
    event: "COMMENT",
    body: "Looks good.",
  });
  assert.equal(result.externalId, "demo-local");
});

test("real ops without a client do not hit GitHub", async () => {
  await assert.rejects(
    () =>
      applyOp(null, {
        type: "github.submit_review",
        owner: "acme",
        repo: "web",
        pull: 1,
        event: "COMMENT",
        body: "Looks good.",
      }),
    /GitHub token missing/,
  );
});
