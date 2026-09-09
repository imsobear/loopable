import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-loops-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");

const { db } = await import("./db/client.ts");
const { loops } = await import("./db/schema.ts");
const { createLoopFromWorkflow, getLoop, updateLoop } = await import("./loops.ts");
const { githubManifest } = await import("#/connectors/github/manifest.ts");

const REVIEW = githubManifest.workflows.find((entry) => entry.id === "github.review_requested")!;

/** A saved loop, with only the field under test changed. */
function edited(id: string, changes: Record<string, unknown>) {
  const loop = getLoop(id)!;
  return updateLoop(id, {
    name: loop.name,
    connectorId: loop.connectorId,
    workflowId: loop.workflowId,
    prompt: loop.prompt,
    guidance: loop.guidance,
    agentId: loop.agentId,
    settings: loop.settings,
    actionConnectorId: loop.actionConnectorId,
    actionId: loop.actionId,
    actionTarget: loop.actionTarget,
    pollEveryMs: loop.pollEveryMs,
    enabled: loop.enabled,
    ...changes,
  });
}

beforeEach(() => {
  db().delete(loops).run();
});

describe("turning a workflow into a loop", () => {
  it("takes a copy of what the workflow asks and where it writes", async () => {
    const loop = createLoopFromWorkflow("github", "github.review_requested");

    expect(loop.prompt).toBe(REVIEW.prompt);
    expect(loop.actionConnectorId).toBe("github");
    expect(loop.actionId).toBe(REVIEW.actionId);
    expect(loop.actionTarget).toEqual({});
  });

  it("keeps an edited prompt, and does not read it back off the workflow", () => {
    const { id } = createLoopFromWorkflow("github", "github.review_requested");
    edited(id, { prompt: "Only check the tests." });

    expect(getLoop(id)!.prompt).toBe("Only check the tests.");
    // The workflow is untouched, so a second loop still starts from it.
    expect(createLoopFromWorkflow("github", "github.review_requested").prompt).toBe(REVIEW.prompt);
  });

  it("refuses to be left with nothing to ask", () => {
    const { id } = createLoopFromWorkflow("github", "github.review_requested");
    // Quietly restoring the template would be worse: the loop would run and
    // write, and not with what the box on screen said.
    expect(() => edited(id, { prompt: "   " })).toThrow(/what the agent should do/);
  });

  /**
   * A read-only connector has no action to fall back to, so a workflow on one
   * has to name where its answer goes or be useless the moment it is turned
   * on. It still only starts there; the loop can be pointed anywhere after.
   */
  it("starts on another connector when the workflow says so", () => {
    const loop = createLoopFromWorkflow("gmail", "gmail.new_mail");

    expect(loop.connectorId).toBe("gmail");
    expect(loop.actionConnectorId).toBe("wechat");
    expect(loop.actionId).toBe("wechat.reply");
    // "Whoever asked" is the action's own default and means nothing here,
    // since no person started this.
    expect(loop.actionTarget).toEqual({ to: "me" });
  });
});

describe("choosing where a loop writes", () => {
  it("accepts an action on a connector it does not watch", () => {
    const { id } = createLoopFromWorkflow("github", "github.review_requested");
    const saved = edited(id, {
      actionConnectorId: "wechat",
      actionId: "wechat.reply",
      actionTarget: { to: "me" },
    });

    expect(saved.actionConnectorId).toBe("wechat");
    expect(saved.actionTarget).toEqual({ to: "me" });
  });

  it("drops a target the chosen action never asked for", () => {
    // Left alone, a stale answer would sit in the column looking meaningful
    // and be read by nothing.
    const { id } = createLoopFromWorkflow("github", "github.review_requested");
    const saved = edited(id, { actionTarget: { issue: "https://github.com/acme/web/issues/1" } });

    expect(saved.actionTarget).toEqual({});
  });

  it("refuses an action the connector does not have", () => {
    const { id } = createLoopFromWorkflow("github", "github.review_requested");
    expect(() => edited(id, { actionId: "github.merge_it" })).toThrow(/cannot github.merge_it/);
  });
});
