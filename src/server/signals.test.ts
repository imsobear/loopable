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
      return answer;
    },
    resolveWorkItem: async () => ({}),
    applyAction: async () => ({ url: "" }),
  }),
}));

vi.mock("./connections.ts", () => ({
  credentialForConnector: async () => ({ credential: { accessToken: "token" } }),
}));

const { db } = await import("./db/client.ts");
const { rules, signals, tasks } = await import("./db/schema.ts");
const { pollAllRules, rulePollState, runBacklog } = await import("./signals.ts");
const { asc, eq } = await import("drizzle-orm");

function givenRule(id: string, priority: number, repositories: string[] = []): void {
  db()
    .insert(rules)
    .values({
      id,
      name: `Rule ${id}`,
      connectorId: "github",
      workflowId: "github.review_requested",
      settings: { repositories },
      priority,
    })
    .run();
}

function pull(number: number, sha = "sha1"): Signal {
  return {
    key: `acme/web#${number}@${sha}`,
    kind: "pull_request",
    repo: "acme/web",
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/web/pull/${number}`,
  };
}

function tasksFor(ruleId: string) {
  return db().select().from(tasks).where(eq(tasks.ruleId, ruleId)).all();
}

function signalsFor(ruleId: string) {
  return db()
    .select()
    .from(signals)
    .where(eq(signals.ruleId, ruleId))
    .orderBy(asc(signals.sourceNumber))
    .all();
}

beforeEach(() => {
  db().delete(tasks).run();
  db().delete(signals).run();
  db().delete(rules).run();
  answer = [];
});

describe("the first look", () => {
  it("records what is already waiting without running any of it", async () => {
    givenRule("a", 1);
    answer = [pull(1), pull(2)];

    const [report] = await pollAllRules();
    expect(report).toMatchObject({ found: 2, queued: 0, backlog: 2, superseded: 0, error: null });
    expect(tasksFor("a")).toHaveLength(0);
    expect(signalsFor("a").map((row) => row.outcome)).toEqual(["backlog", "backlog"]);
  });

  it("acts on everything that turns up after it", async () => {
    givenRule("a", 1);
    answer = [pull(1)];
    await pollAllRules();

    answer = [pull(1), pull(2)];
    const [report] = await pollAllRules();
    expect(report).toMatchObject({ found: 2, queued: 1, backlog: 0 });

    const queued = tasksFor("a");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      sourceNumber: 2,
      sourceTitle: "Change 2",
      state: "queued",
      dryRun: false,
      dedupeKey: "a:acme/web#2@sha1",
    });
  });

  it("is not spent by a look that failed, so the backlog is still the backlog", async () => {
    givenRule("a", 1);
    answer = new Error("GitHub 401: bad credentials");

    const [failed] = await pollAllRules();
    expect(failed).toMatchObject({ error: "GitHub 401: bad credentials", found: 0 });
    expect(rulePollState("a").polledAt).toBeNull();

    answer = [pull(1)];
    const [recovered] = await pollAllRules();
    expect(recovered).toMatchObject({ backlog: 1, queued: 0, error: null });
    expect(rulePollState("a").pollError).toBeNull();
  });
});

describe("looking again", () => {
  it("leaves a key it has already dealt with alone", async () => {
    givenRule("a", 1);
    answer = [pull(1)];
    await pollAllRules();
    answer = [pull(2)];
    await pollAllRules();

    answer = [pull(2)];
    const [report] = await pollAllRules();
    expect(report).toMatchObject({ found: 1, queued: 0, backlog: 0 });
    expect(tasksFor("a")).toHaveLength(1);
  });

  it("acts again when the same pull request has a new commit", async () => {
    givenRule("a", 1);
    answer = [];
    await pollAllRules();

    answer = [pull(1, "sha1")];
    await pollAllRules();
    answer = [pull(1, "sha2")];
    await pollAllRules();

    expect(tasksFor("a")).toHaveLength(2);
  });

  it("skips a rule that is off", async () => {
    givenRule("a", 1);
    db().update(rules).set({ enabled: false }).where(eq(rules.id, "a")).run();
    answer = [pull(1)];
    expect(await pollAllRules()).toEqual([]);
  });
});

describe("two rules wanting the same thing", () => {
  it("gives it to the one that comes first", async () => {
    givenRule("first", 1);
    givenRule("second", 2);
    // Both are past their first look, so both would otherwise queue it.
    answer = [];
    await pollAllRules();

    answer = [pull(1)];
    const reports = await pollAllRules();
    expect(reports.map((report) => [report.ruleId, report.queued, report.superseded])).toEqual([
      ["first", 1, 0],
      ["second", 0, 1],
    ]);
    expect(tasksFor("first")).toHaveLength(1);
    expect(tasksFor("second")).toHaveLength(0);
  });

  it("does not hand it back to the second rule on the next look", async () => {
    givenRule("first", 1);
    givenRule("second", 2);
    answer = [];
    await pollAllRules();
    answer = [pull(1)];
    await pollAllRules();
    await pollAllRules();

    expect(tasksFor("second")).toHaveLength(0);
    expect(signalsFor("second").map((row) => row.outcome)).toEqual(["superseded"]);
  });
});

describe("running the backlog", () => {
  it("queues everything that was held, once", async () => {
    givenRule("a", 1);
    answer = [pull(1), pull(2)];
    await pollAllRules();

    expect(rulePollState("a").backlog.map((item) => item.sourceNumber)).toEqual([1, 2]);
    expect(runBacklog("a")).toBe(2);

    const queued = tasksFor("a");
    expect(queued).toHaveLength(2);
    expect(queued.every((task) => task.state === "queued")).toBe(true);
    expect(rulePollState("a").backlog).toEqual([]);

    // Nothing left to run, and the next look does not queue them again.
    expect(runBacklog("a")).toBe(0);
    await pollAllRules();
    expect(tasksFor("a")).toHaveLength(2);
  });
});

describe("something the connector will not run by itself", () => {
  const tooBig = (number: number): Signal => ({
    ...pull(number),
    hold: "80 files changed, over this rule's 50",
  });

  it("is kept and named rather than dropped, long after the first look", async () => {
    givenRule("a", 1);
    answer = [];
    await pollAllRules();

    answer = [tooBig(1)];
    const [report] = await pollAllRules();
    expect(report).toMatchObject({ found: 1, queued: 0, held: 1, backlog: 0 });
    expect(tasksFor("a")).toHaveLength(0);

    const [waiting] = rulePollState("a").backlog;
    expect(waiting).toMatchObject({
      sourceNumber: 1,
      hold: "80 files changed, over this rule's 50",
    });
  });

  it("is not held a second time once it is on the list", async () => {
    givenRule("a", 1);
    answer = [];
    await pollAllRules();

    answer = [tooBig(1)];
    await pollAllRules();
    const [again] = await pollAllRules();
    expect(again).toMatchObject({ found: 1, held: 0 });
    expect(rulePollState("a").backlog).toHaveLength(1);
  });

  it("runs when it is asked for on purpose", async () => {
    givenRule("a", 1);
    answer = [];
    await pollAllRules();

    answer = [tooBig(1)];
    await pollAllRules();
    expect(runBacklog("a")).toBe(1);

    expect(tasksFor("a")).toHaveLength(1);
    expect(rulePollState("a").backlog).toEqual([]);
  });

  it("still counts as taken, so a later rule does not pick it up", async () => {
    givenRule("a", 1);
    givenRule("b", 2);
    answer = [];
    await pollAllRules();

    answer = [tooBig(1)];
    const [first, second] = await pollAllRules();
    expect(first).toMatchObject({ held: 1 });
    expect(second).toMatchObject({ queued: 0, superseded: 1 });
    expect(tasksFor("b")).toHaveLength(0);
  });

  it("leaves a new commit on it held as well", async () => {
    givenRule("a", 1);
    answer = [];
    await pollAllRules();

    answer = [tooBig(1)];
    await pollAllRules();
    answer = [{ ...pull(1, "sha2"), hold: "81 files changed, over this rule's 50" }];
    const [report] = await pollAllRules();

    expect(report).toMatchObject({ held: 1, queued: 0 });
    expect(rulePollState("a").backlog.map((item) => item.hold)).toEqual([
      "80 files changed, over this rule's 50",
      "81 files changed, over this rule's 50",
    ]);
  });
});
