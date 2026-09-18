import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-loops-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { loops } = await import("./db/schema.ts");
const { createLoop, getLoop, updateLoop } = await import("./loops.ts");
const { draftForWorkflow } = await import("#/lib/loop-draft.ts");
const { githubManifest } = await import("#/connectors/github/manifest.ts");

await migrateIfNeeded();

const REVIEW = githubManifest.workflows.find((entry) => entry.id === "github.review_requested")!;

/** Both steps at once: what the form does when somebody presses the button. */
function added(connectorId: string, workflowId: string, changes: Record<string, unknown> = {}) {
  return createLoop({ ...draftForWorkflow(connectorId, workflowId), ...changes });
}

/** A saved loop, with only the field under test changed. */
async function edited(id: string, changes: Record<string, unknown>) {
  const loop = (await getLoop(id))!;
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

beforeEach(async () => {
  await db().delete(loops).run();
});

describe("choosing a workflow", () => {
  /**
   * The reason a draft exists at all. Choosing used to create the loop, so
   * opening the page and looking at what was on offer left a live loop
   * behind: enabled, watching, and with none of its questions answered.
   */
  it("writes nothing down until it is saved", async () => {
    const draft = draftForWorkflow("github", "github.review_requested");

    expect(draft.id).toBeNull();
    expect(await db().select().from(loops).all()).toHaveLength(0);

    await createLoop({ ...draft, settings: { repositories: [] } });
    expect(await db().select().from(loops).all()).toHaveLength(1);
  });

  it("hands the form something to fill in rather than defaults to discover", () => {
    const draft = draftForWorkflow("github", "github.review_requested");

    expect(draft.name).toBe(REVIEW.name);
    expect(draft.prompt).toBe(REVIEW.prompt);
    // On when saved, because pressing the button is the whole of meaning to.
    expect(draft.enabled).toBe(true);
  });
});

describe("turning a workflow into a loop", () => {
  it("takes a copy of what the workflow asks and where it writes", async () => {
    const loop = await added("github", "github.review_requested");

    expect(loop.prompt).toBe(REVIEW.prompt);
    expect(loop.actionConnectorId).toBe("github");
    expect(loop.actionId).toBe(REVIEW.actionId);
    expect(loop.actionTarget).toEqual({});
  });

  it("keeps an edited prompt, and does not read it back off the workflow", async () => {
    const { id } = await added("github", "github.review_requested");
    await edited(id, { prompt: "Only check the tests." });

    expect((await getLoop(id))!.prompt).toBe("Only check the tests.");
    // The workflow is untouched, so a second loop still starts from it.
    expect((await added("github", "github.review_requested")).prompt).toBe(REVIEW.prompt);
  });

  it("refuses to be left with nothing to ask", async () => {
    const { id } = await added("github", "github.review_requested");
    // Quietly restoring the template would be worse: the loop would run and
    // write, and not with what the box on screen said.
    await expect(edited(id, { prompt: "   " })).rejects.toThrow(/what the agent should do/);
  });

  /**
   * A read-only connector has no action to fall back to, so a workflow on one
   * has to name where its answer goes or be useless the moment it is turned
   * on. It still only starts there; the loop can be pointed anywhere after.
   */
  it("starts on another connector when the workflow says so", async () => {
    const loop = await added("gmail", "gmail.new_mail");

    expect(loop.connectorId).toBe("gmail");
    expect(loop.actionConnectorId).toBe("wechat");
    expect(loop.actionId).toBe("wechat.reply");
    // "Whoever asked" is the action's own default and means nothing here,
    // since no person started this.
    expect(loop.actionTarget).toEqual({ to: "me" });
  });
});

/**
 * Saving is the last moment anybody is looking, so it is the moment to refuse
 * a loop that cannot work. A job that needs a checkout and has not been given
 * one would sit enabled, come round on time, and fail at the last step every
 * time, which is a slow way to be told to fill in a box.
 */
describe("a loop that has to work somewhere", () => {
  it("will not be saved without the folder it works in", async () => {
    await expect(added("schedule", "schedule.recurring")).rejects.toThrow(/which folder/);
    await expect(added("schedule", "schedule.recurring", { settings: { folder: "  " } })).rejects.toThrow(
      /which folder/,
    );
  });

  it("is saved once it has one", async () => {
    const loop = await added("schedule", "schedule.recurring", {
      settings: { every: "day", at: "09:00", weekday: "1", folder: "/Users/you/code/web" },
    });

    expect(loop.settings.folder).toBe("/Users/you/code/web");
  });

  it("does not ask for one where the agent is given no checkout", async () => {
    // Judging a diff needs the diff and nothing else, so there is nothing to
    // name and nothing to refuse.
    await expect(added("github", "github.review_requested")).resolves.toBeTruthy();
  });

  it("does not ask for a local clone when the agent will clone the repository", async () => {
    await expect(added("github", "github.issue_implement")).resolves.toBeTruthy();
  });
});

describe("choosing where a loop writes", () => {
  it("accepts an action on a connector it does not watch", async () => {
    const { id } = await added("github", "github.review_requested");
    const saved = await edited(id, {
      actionConnectorId: "wechat",
      actionId: "wechat.reply",
      actionTarget: { to: "me" },
    });

    expect(saved.actionConnectorId).toBe("wechat");
    expect(saved.actionTarget).toEqual({ to: "me" });
  });

  it("drops a target the chosen action never asked for", async () => {
    // Left alone, a stale answer would sit in the column looking meaningful
    // and be read by nothing.
    const { id } = await added("github", "github.review_requested");
    const saved = await edited(id, { actionTarget: { issue: "https://github.com/acme/web/issues/1" } });

    expect(saved.actionTarget).toEqual({});
  });

  it("refuses an action the connector does not have", async () => {
    const { id } = await added("github", "github.review_requested");
    await expect(edited(id, { actionId: "github.merge_it" })).rejects.toThrow(/cannot github.merge_it/);
  });
});
