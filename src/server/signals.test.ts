import { mkdtempSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "#/connectors/types.ts";

const home = mkdtempSync(join(tmpdir(), "loopable-signals-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";

/** What the fake connector will answer with on the next look. */
let answer: Signal[] | Error = [];

vi.mock("#/connectors/runtimes.ts", () => ({
  connectorRuntime: () => ({
    poll: async () => {
      if (answer instanceof Error) throw answer;
      return { signals: answer };
    },
    resolveWorkItem: async () => ({}),
    applyAction: async () => ({ url: "" }),
  }),
}));

vi.mock("./connections.ts", () => ({
  credentialForConnector: async () => ({ credential: { accessToken: "token" } }),
}));

/** What the triage run will decide, when a loop asks for one. */
let triaged = '{"needsMe": []}';
let triageRuns = 0;

vi.mock("#/agents/runtimes.ts", () => ({
  agentRuntime: () => ({
    run: async () => {
      triageRuns += 1;
      return { ok: true, output: triaged, durationMs: 1, command: { bin: "x", args: [] } };
    },
  }),
}));

vi.mock("./agents.ts", () => ({
  listAgents: async () => [{ agentId: "cursor-agent", isDefault: true, installed: true }],
  settingsFor: () => ({ permissionMode: "read_only", model: null, timeoutMs: 1_000 }),
}));

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { loops, runners, signals, tasks } = await import("./db/schema.ts");
const { pollAllLoops, loopPollState, runBacklog, lookNow } = await import("./signals.ts");
const { getJoinToken, joinRunner } = await import("./runners.ts");
const { asc, eq } = await import("drizzle-orm");

await migrateIfNeeded();

async function givenLoop(id: string, priority: number, repositories: string[] = []): Promise<void> {
  await db()
    .insert(loops)
    .values({
      id,
      name: `Loop ${id}`,
      connectorId: "github",
      workflowId: "github.review_requested",
      prompt: "Review it.",
      actionConnectorId: "github",
      actionId: "github.submit_review",
      settings: { repositories },
      priority,
    })
    .run();
}

function pull(number: number, sha = "sha1"): Signal {
  return {
    key: `acme/web#${number}@${sha}`,
    kind: "pull_request",
    ref: `acme/web#${number}`,
    title: `Change ${number}`,
    url: `https://github.com/acme/web/pull/${number}`,
  };
}

async function tasksFor(loopId: string) {
  return await db().select().from(tasks).where(eq(tasks.loopId, loopId)).all();
}

async function signalsFor(loopId: string) {
  return await db()
    .select()
    .from(signals)
    .where(eq(signals.loopId, loopId))
    .orderBy(asc(signals.sourceRef))
    .all();
}

beforeEach(async () => {
  await db().delete(tasks).run();
  await db().delete(signals).run();
  await db().delete(loops).run();
  await db().delete(runners).run();
  answer = [];
  triaged = '{"needsMe": []}';
  triageRuns = 0;
  await joinRunner({
    joinToken: await getJoinToken(),
    hostname: osHostname(),
    inventory: [
      { agentId: "cursor-agent", installed: true, version: "1", signedIn: true, detail: "ok" },
    ],
  });
});

describe("the first look", () => {
  it("records what is already waiting without running any of it", async () => {
    await givenLoop("a", 1);
    answer = [pull(1), pull(2)];

    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 2, queued: 0, backlog: 2, superseded: 0, error: null });
    expect(await tasksFor("a")).toHaveLength(0);
    expect((await signalsFor("a")).map((row) => row.outcome)).toEqual(["backlog", "backlog"]);
  });

  it("acts on everything that turns up after it", async () => {
    await givenLoop("a", 1);
    answer = [pull(1)];
    await pollAllLoops();

    answer = [pull(1), pull(2)];
    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 2, queued: 1, backlog: 0 });

    const queued = await tasksFor("a");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      sourceRef: "acme/web#2",
      sourceTitle: "Change 2",
      state: "queued",
      dryRun: false,
      dedupeKey: "a:acme/web#2@sha1",
    });
  });

  it("is not spent by a look that failed, so the backlog is still the backlog", async () => {
    await givenLoop("a", 1);
    answer = new Error("GitHub 401: bad credentials");

    const [failed] = await pollAllLoops();
    expect(failed).toMatchObject({ error: "GitHub 401: bad credentials", found: 0 });
    expect((await loopPollState("a")).polledAt).toBeNull();

    answer = [pull(1)];
    const [recovered] = await pollAllLoops();
    expect(recovered).toMatchObject({ backlog: 1, queued: 0, error: null });
    expect((await loopPollState("a")).pollError).toBeNull();
  });
});

describe("looking again", () => {
  it("leaves a key it has already dealt with alone", async () => {
    await givenLoop("a", 1);
    answer = [pull(1)];
    await pollAllLoops();
    answer = [pull(2)];
    await pollAllLoops();

    answer = [pull(2)];
    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 1, queued: 0, backlog: 0 });
    expect(await tasksFor("a")).toHaveLength(1);
  });

  it("acts again when the same pull request has a new commit", async () => {
    await givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [pull(1, "sha1")];
    await pollAllLoops();
    answer = [pull(1, "sha2")];
    await pollAllLoops();

    expect(await tasksFor("a")).toHaveLength(2);
  });

  it("skips a loop that is off", async () => {
    await givenLoop("a", 1);
    await db().update(loops).set({ enabled: false }).where(eq(loops.id, "a")).run();
    answer = [pull(1)];
    expect(await pollAllLoops()).toEqual([]);
  });
});

describe("two loops wanting the same thing", () => {
  it("gives it to the one that comes first", async () => {
    await givenLoop("first", 1);
    await givenLoop("second", 2);
    // Both are past their first look, so both would otherwise queue it.
    answer = [];
    await pollAllLoops();

    answer = [pull(1)];
    const reports = await pollAllLoops();
    expect(reports.map((report) => [report.loopId, report.queued, report.superseded])).toEqual([
      ["first", 1, 0],
      ["second", 0, 1],
    ]);
    expect(await tasksFor("first")).toHaveLength(1);
    expect(await tasksFor("second")).toHaveLength(0);
  });

  it("does not hand it back to the second loop on the next look", async () => {
    await givenLoop("first", 1);
    await givenLoop("second", 2);
    answer = [];
    await pollAllLoops();
    answer = [pull(1)];
    await pollAllLoops();
    await pollAllLoops();

    expect(await tasksFor("second")).toHaveLength(0);
    expect((await signalsFor("second")).map((row) => row.outcome)).toEqual(["superseded"]);
  });
});

describe("running the backlog", () => {
  it("queues everything that was held, once", async () => {
    await givenLoop("a", 1);
    answer = [pull(1), pull(2)];
    await pollAllLoops();

    expect((await loopPollState("a")).backlog.map((item) => item.sourceRef)).toEqual([
      "acme/web#1",
      "acme/web#2",
    ]);
    expect(await runBacklog("a")).toBe(2);

    const queued = await tasksFor("a");
    expect(queued).toHaveLength(2);
    expect(queued.every((task) => task.state === "queued")).toBe(true);
    expect((await loopPollState("a")).backlog).toEqual([]);

    // Nothing left to run, and the next look does not queue them again.
    expect(await runBacklog("a")).toBe(0);
    await pollAllLoops();
    expect(await tasksFor("a")).toHaveLength(2);
  });
});

describe("how often to look", () => {
  async function every(id: string, ms: number | null): Promise<void> {
    await db().update(loops).set({ pollEveryMs: ms }).where(eq(loops.id, id)).run();
  }

  /** As if the last look happened this long ago. */
  async function lastLooked(id: string, msAgo: number): Promise<void> {
    await db()
      .update(loops)
      .set({ polledAt: new Date(Date.now() - msAgo) })
      .where(eq(loops.id, id))
      .run();
  }

  it("looks straight away the first time, whatever the interval says", async () => {
    await givenLoop("a", 1);
    await every("a", 30 * 60_000);

    answer = [pull(1)];
    expect(await pollAllLoops()).toHaveLength(1);
  });

  it("then leaves it alone until the interval is up", async () => {
    await givenLoop("a", 1);
    await every("a", 30 * 60_000);
    answer = [];
    await pollAllLoops();

    answer = [pull(1)];
    expect(await pollAllLoops()).toEqual([]);
    expect(await tasksFor("a")).toHaveLength(0);

    await lastLooked("a", 29 * 60_000);
    expect(await pollAllLoops()).toEqual([]);

    await lastLooked("a", 31 * 60_000);
    expect(await pollAllLoops()).toHaveLength(1);
    expect(await tasksFor("a")).toHaveLength(1);
  });

  it("looks every time when no interval is set", async () => {
    await givenLoop("a", 1);
    await every("a", null);
    answer = [];
    await pollAllLoops();

    answer = [pull(1)];
    expect(await pollAllLoops()).toHaveLength(1);
    expect(await tasksFor("a")).toHaveLength(1);
  });

  it("lets a loop that is due take what a waiting one would have claimed", async () => {
    // Priority settles a tie between loops looked at together, and two loops
    // on different clocks are not looked at together. Worth a test because it
    // reads as priority being ignored.
    await givenLoop("first", 1);
    await givenLoop("second", 2);
    await every("first", 30 * 60_000);
    answer = [];
    await pollAllLoops();

    answer = [pull(1)];
    const reports = await pollAllLoops();
    expect(reports.map((report) => report.loopId)).toEqual(["second"]);
    expect(await tasksFor("second")).toHaveLength(1);
    expect(await tasksFor("first")).toHaveLength(0);
  });

  it("looks now even when the interval would wait", async () => {
    await givenLoop("a", 1);
    await every("a", 30 * 60_000);
    answer = [];
    await pollAllLoops();

    answer = [pull(1)];
    expect(await pollAllLoops()).toEqual([]);

    const report = await lookNow("a");
    expect(report).toMatchObject({ found: 1, queued: 1, error: null });
    expect(await tasksFor("a")).toHaveLength(1);
  });

  it("does not look at a loop that is off", async () => {
    await givenLoop("a", 1);
    await db().update(loops).set({ enabled: false }).where(eq(loops.id, "a")).run();
    await expect(lookNow("a")).rejects.toThrow("This loop is off");
  });

  it("says when the loop is gone", async () => {
    await expect(lookNow("missing")).rejects.toThrow("Loop not found");
  });
});

describe("deciding what is worth a run", () => {
  /** A loop that asks for the cheap look first. */
  async function givenTriagingLoop(id: string): Promise<void> {
    await db()
      .insert(loops)
      .values({
        id,
        name: `Loop ${id}`,
        connectorId: "github",
        workflowId: "github.review_requested",
        prompt: "Review it.",
        actionConnectorId: "github",
        actionId: "github.submit_review",
        settings: { needsMeOnly: true },
        priority: 1,
      })
      .run();
  }

  /** Past the first look, which goes to the backlog whatever triage thinks. */
  async function settled(id: string): Promise<void> {
    await givenTriagingLoop(id);
    answer = [];
    await pollAllLoops();
    triageRuns = 0;
  }

  it("runs only what the one look picked out, and holds the rest with a reason", async () => {
    await settled("a");
    triaged = '{"needsMe": [2]}';

    answer = [pull(1), pull(2), pull(3)];
    const [report] = await pollAllLoops();

    // One agent run decided the fate of three, instead of three runs.
    expect(triageRuns).toBe(1);
    expect(report).toMatchObject({ found: 3, queued: 1, held: 2, triaged: 2 });
    expect(await tasksFor("a")).toHaveLength(1);

    const held = (await signalsFor("a")).filter((row) => row.outcome === "held");
    expect(held.map((row) => row.sourceRef)).toEqual(["acme/web#1", "acme/web#3"]);
    expect(held[0]!.hold).toBe("nothing in it was being asked of you");
  });

  it("still lets a held one be run on purpose, when the look got it wrong", async () => {
    await settled("a");
    triaged = '{"needsMe": []}';

    answer = [pull(1), pull(2), pull(3)];
    await pollAllLoops();
    expect(await tasksFor("a")).toHaveLength(0);

    // The whole reason for holding rather than dropping.
    expect(await runBacklog("a")).toBe(3);
    expect(await tasksFor("a")).toHaveLength(3);
  });

  it("leaves a loop that did not ask for it alone", async () => {
    await givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [pull(1), pull(2), pull(3)];
    const [report] = await pollAllLoops();

    expect(triageRuns).toBe(0);
    expect(report).toMatchObject({ queued: 3, held: 0, triaged: 0 });
  });

  it("does not weigh up a backlog nobody was going to run", async () => {
    // The first look is the case: everything is going to the backlog, so
    // asking which of it matters would be paying for an answer nothing uses.
    await givenTriagingLoop("a");
    answer = [pull(1), pull(2), pull(3)];
    const [report] = await pollAllLoops();

    expect(triageRuns).toBe(0);
    expect(report).toMatchObject({ backlog: 3, held: 0 });
  });

  it("weighs up two, and does not bother for one", async () => {
    await settled("a");
    triaged = '{"needsMe": [1]}';

    // One run to decide whether to do one run is the same money at best.
    answer = [pull(1)];
    const [alone] = await pollAllLoops();
    expect(triageRuns).toBe(0);
    expect(alone).toMatchObject({ queued: 1, triaged: 0 });

    // Two can pay for it, and this is the size that actually turns up when a
    // loop looks often: three was rare enough that nothing was ever weighed.
    answer = [pull(1), pull(2), pull(3)];
    const [pair] = await pollAllLoops();
    expect(triageRuns).toBe(1);
    expect(pair).toMatchObject({ queued: 1, held: 1, triaged: 1 });
  });

  it("does not weigh up what the connector already refused", async () => {
    await settled("a");
    triaged = '{"needsMe": []}';

    // A hold the connector gave says more than triage can, and asking about
    // one item would cost a run to save one.
    answer = [{ ...pull(1), hold: "80 files changed" }];
    const [report] = await pollAllLoops();

    expect(triageRuns).toBe(0);
    expect(report).toMatchObject({ held: 1, triaged: 0 });
    expect((await signalsFor("a"))[0]!.hold).toBe("80 files changed");
  });
});

describe("something the connector will not run by itself", () => {
  const tooBig = (number: number): Signal => ({
    ...pull(number),
    hold: "80 files changed, over this loop's 50",
  });

  it("is kept and named rather than dropped, long after the first look", async () => {
    await givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 1, queued: 0, held: 1, backlog: 0 });
    expect(await tasksFor("a")).toHaveLength(0);

    const [waiting] = (await loopPollState("a")).backlog;
    expect(waiting).toMatchObject({
      sourceRef: "acme/web#1",
      hold: "80 files changed, over this loop's 50",
    });
  });

  it("is not held a second time once it is on the list", async () => {
    await givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    await pollAllLoops();
    const [again] = await pollAllLoops();
    expect(again).toMatchObject({ found: 1, held: 0 });
    expect((await loopPollState("a")).backlog).toHaveLength(1);
  });

  it("runs when it is asked for on purpose", async () => {
    await givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    await pollAllLoops();
    expect(await runBacklog("a")).toBe(1);

    expect(await tasksFor("a")).toHaveLength(1);
    expect((await loopPollState("a")).backlog).toEqual([]);
  });

  it("still counts as taken, so a later loop does not pick it up", async () => {
    await givenLoop("a", 1);
    await givenLoop("b", 2);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    const [first, second] = await pollAllLoops();
    expect(first).toMatchObject({ held: 1 });
    expect(second).toMatchObject({ queued: 0, superseded: 1 });
    expect(await tasksFor("b")).toHaveLength(0);
  });

  it("leaves a new commit on it held as well", async () => {
    await givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    await pollAllLoops();
    answer = [{ ...pull(1, "sha2"), hold: "81 files changed, over this loop's 50" }];
    const [report] = await pollAllLoops();

    expect(report).toMatchObject({ held: 1, queued: 0 });
    expect((await loopPollState("a")).backlog.map((item) => item.hold)).toEqual([
      "80 files changed, over this loop's 50",
      "81 files changed, over this loop's 50",
    ]);
  });
});
