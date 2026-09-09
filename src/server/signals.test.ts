import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "#/connectors/types.ts";

const home = mkdtempSync(join(tmpdir(), "loopable-signals-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");

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

const { db } = await import("./db/client.ts");
const { loops, signals, tasks } = await import("./db/schema.ts");
const { pollAllLoops, loopPollState, runBacklog } = await import("./signals.ts");
const { asc, eq } = await import("drizzle-orm");

function givenLoop(id: string, priority: number, repositories: string[] = []): void {
  db()
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

function tasksFor(loopId: string) {
  return db().select().from(tasks).where(eq(tasks.loopId, loopId)).all();
}

function signalsFor(loopId: string) {
  return db()
    .select()
    .from(signals)
    .where(eq(signals.loopId, loopId))
    .orderBy(asc(signals.sourceRef))
    .all();
}

beforeEach(() => {
  db().delete(tasks).run();
  db().delete(signals).run();
  db().delete(loops).run();
  answer = [];
});

describe("the first look", () => {
  it("records what is already waiting without running any of it", async () => {
    givenLoop("a", 1);
    answer = [pull(1), pull(2)];

    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 2, queued: 0, backlog: 2, superseded: 0, error: null });
    expect(tasksFor("a")).toHaveLength(0);
    expect(signalsFor("a").map((row) => row.outcome)).toEqual(["backlog", "backlog"]);
  });

  it("acts on everything that turns up after it", async () => {
    givenLoop("a", 1);
    answer = [pull(1)];
    await pollAllLoops();

    answer = [pull(1), pull(2)];
    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 2, queued: 1, backlog: 0 });

    const queued = tasksFor("a");
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
    givenLoop("a", 1);
    answer = new Error("GitHub 401: bad credentials");

    const [failed] = await pollAllLoops();
    expect(failed).toMatchObject({ error: "GitHub 401: bad credentials", found: 0 });
    expect(loopPollState("a").polledAt).toBeNull();

    answer = [pull(1)];
    const [recovered] = await pollAllLoops();
    expect(recovered).toMatchObject({ backlog: 1, queued: 0, error: null });
    expect(loopPollState("a").pollError).toBeNull();
  });
});

describe("looking again", () => {
  it("leaves a key it has already dealt with alone", async () => {
    givenLoop("a", 1);
    answer = [pull(1)];
    await pollAllLoops();
    answer = [pull(2)];
    await pollAllLoops();

    answer = [pull(2)];
    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 1, queued: 0, backlog: 0 });
    expect(tasksFor("a")).toHaveLength(1);
  });

  it("acts again when the same pull request has a new commit", async () => {
    givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [pull(1, "sha1")];
    await pollAllLoops();
    answer = [pull(1, "sha2")];
    await pollAllLoops();

    expect(tasksFor("a")).toHaveLength(2);
  });

  it("skips a loop that is off", async () => {
    givenLoop("a", 1);
    db().update(loops).set({ enabled: false }).where(eq(loops.id, "a")).run();
    answer = [pull(1)];
    expect(await pollAllLoops()).toEqual([]);
  });
});

describe("two loops wanting the same thing", () => {
  it("gives it to the one that comes first", async () => {
    givenLoop("first", 1);
    givenLoop("second", 2);
    // Both are past their first look, so both would otherwise queue it.
    answer = [];
    await pollAllLoops();

    answer = [pull(1)];
    const reports = await pollAllLoops();
    expect(reports.map((report) => [report.loopId, report.queued, report.superseded])).toEqual([
      ["first", 1, 0],
      ["second", 0, 1],
    ]);
    expect(tasksFor("first")).toHaveLength(1);
    expect(tasksFor("second")).toHaveLength(0);
  });

  it("does not hand it back to the second loop on the next look", async () => {
    givenLoop("first", 1);
    givenLoop("second", 2);
    answer = [];
    await pollAllLoops();
    answer = [pull(1)];
    await pollAllLoops();
    await pollAllLoops();

    expect(tasksFor("second")).toHaveLength(0);
    expect(signalsFor("second").map((row) => row.outcome)).toEqual(["superseded"]);
  });
});

describe("running the backlog", () => {
  it("queues everything that was held, once", async () => {
    givenLoop("a", 1);
    answer = [pull(1), pull(2)];
    await pollAllLoops();

    expect(loopPollState("a").backlog.map((item) => item.sourceRef)).toEqual([
      "acme/web#1",
      "acme/web#2",
    ]);
    expect(runBacklog("a")).toBe(2);

    const queued = tasksFor("a");
    expect(queued).toHaveLength(2);
    expect(queued.every((task) => task.state === "queued")).toBe(true);
    expect(loopPollState("a").backlog).toEqual([]);

    // Nothing left to run, and the next look does not queue them again.
    expect(runBacklog("a")).toBe(0);
    await pollAllLoops();
    expect(tasksFor("a")).toHaveLength(2);
  });
});

describe("something the connector will not run by itself", () => {
  const tooBig = (number: number): Signal => ({
    ...pull(number),
    hold: "80 files changed, over this loop's 50",
  });

  it("is kept and named rather than dropped, long after the first look", async () => {
    givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    const [report] = await pollAllLoops();
    expect(report).toMatchObject({ found: 1, queued: 0, held: 1, backlog: 0 });
    expect(tasksFor("a")).toHaveLength(0);

    const [waiting] = loopPollState("a").backlog;
    expect(waiting).toMatchObject({
      sourceRef: "acme/web#1",
      hold: "80 files changed, over this loop's 50",
    });
  });

  it("is not held a second time once it is on the list", async () => {
    givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    await pollAllLoops();
    const [again] = await pollAllLoops();
    expect(again).toMatchObject({ found: 1, held: 0 });
    expect(loopPollState("a").backlog).toHaveLength(1);
  });

  it("runs when it is asked for on purpose", async () => {
    givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    await pollAllLoops();
    expect(runBacklog("a")).toBe(1);

    expect(tasksFor("a")).toHaveLength(1);
    expect(loopPollState("a").backlog).toEqual([]);
  });

  it("still counts as taken, so a later loop does not pick it up", async () => {
    givenLoop("a", 1);
    givenLoop("b", 2);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    const [first, second] = await pollAllLoops();
    expect(first).toMatchObject({ held: 1 });
    expect(second).toMatchObject({ queued: 0, superseded: 1 });
    expect(tasksFor("b")).toHaveLength(0);
  });

  it("leaves a new commit on it held as well", async () => {
    givenLoop("a", 1);
    answer = [];
    await pollAllLoops();

    answer = [tooBig(1)];
    await pollAllLoops();
    answer = [{ ...pull(1, "sha2"), hold: "81 files changed, over this loop's 50" }];
    const [report] = await pollAllLoops();

    expect(report).toMatchObject({ held: 1, queued: 0 });
    expect(loopPollState("a").backlog.map((item) => item.hold)).toEqual([
      "80 files changed, over this loop's 50",
      "81 files changed, over this loop's 50",
    ]);
  });
});
