import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Point the whole server at a throwaway database before anything opens one.
const home = mkdtempSync(join(tmpdir(), "loopable-test-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");

const { db } = await import("./db/client.ts");
const { loops, tasks } = await import("./db/schema.ts");
const { createWorker } = await import("./worker.ts");
const { writeSetting } = await import("./settings.ts");
const { TransientError } = await import("#/connectors/errors.ts");
const { TaskCancelled } = await import("./tasks.ts");
const { eq } = await import("drizzle-orm");

const LOOP_ID = "loop-under-test";

function givenLoop(): void {
  db()
    .insert(loops)
    .values({
      id: LOOP_ID,
      name: "Test loop",
      connectorId: "github",
      workflowId: "github.review_requested",
      priority: 1,
    })
    .onConflictDoNothing()
    .run();
}

function givenTask(values: Partial<typeof tasks.$inferInsert> = {}): string {
  const id = values.id ?? randomUUID();
  db()
    .insert(tasks)
    .values({
      id,
      loopId: LOOP_ID,
      connectorId: "github",
      state: "queued",
      sourceUrl: "https://github.com/acme/web/pull/1",
      sourceKind: "pull_request",
      sourceRef: "acme/web#1",
      actionId: "github.submit_review",
      ...values,
    })
    .run();
  return id;
}

function taskById(id: string) {
  return db().select().from(tasks).where(eq(tasks.id, id)).get()!;
}

/** Stands in for a real run, which would take minutes and cost money. */
function fakeRun(behaviour: (id: string) => void | Promise<void>) {
  const seen: string[] = [];
  return {
    seen,
    run: async (id: string) => {
      seen.push(id);
      await behaviour(id);
      db().update(tasks).set({ state: "done" }).where(eq(tasks.id, id)).run();
    },
  };
}

beforeEach(() => {
  db().delete(tasks).run();
  db().delete(loops).run();
  givenLoop();
  writeSetting("runner.paused", false);
  writeSetting("runner.maxConcurrentRuns", 1);
});

describe("worker", () => {
  it("claims a queued task, runs it, and records the attempt", async () => {
    const id = givenTask();
    const agent = fakeRun(() => {});
    const worker = createWorker({ runTask: agent.run });

    expect(await worker.tick()).toBe(1);
    await worker.drain();

    expect(agent.seen).toEqual([id]);
    const task = taskById(id);
    expect(task.state).toBe("done");
    expect(task.attempts).toBe(1);
    expect(task.startedAt).not.toBeNull();
  });

  it("never lets two workers take the same task", async () => {
    const id = givenTask();
    const first = fakeRun(() => {});
    const second = fakeRun(() => {});

    const started = await Promise.all([
      createWorker({ runTask: first.run }).tick(),
      createWorker({ runTask: second.run }).tick(),
    ]);

    expect(started.reduce((a, b) => a + b, 0)).toBe(1);
    expect([...first.seen, ...second.seen]).toEqual([id]);
    expect(taskById(id).attempts).toBe(1);
  });

  it("starts no more than the configured number at once", async () => {
    givenTask();
    givenTask();
    givenTask();
    writeSetting("runner.maxConcurrentRuns", 2);

    let release = () => {};
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = fakeRun(() => holding);
    const worker = createWorker({ runTask: agent.run });

    expect(await worker.tick()).toBe(2);
    expect(worker.running()).toBe(2);
    expect(await worker.tick()).toBe(0);

    release();
    await worker.drain();
    expect(await worker.tick()).toBe(1);
    await worker.drain();
  });

  it("starts nothing while paused", async () => {
    givenTask();
    writeSetting("runner.paused", true);
    const agent = fakeRun(() => {});

    expect(await createWorker({ runTask: agent.run }).tick()).toBe(0);
    expect(agent.seen).toEqual([]);
  });

  it("tries a transient failure again, after a wait", async () => {
    const id = givenTask();
    const worker = createWorker({
      runTask: async () => {
        throw new TransientError("GitHub is having a moment");
      },
    });

    await worker.tick();
    await worker.drain();

    const task = taskById(id);
    expect(task.state).toBe("queued");
    expect(task.attempts).toBe(1);
    expect(task.error).toContain("GitHub is having a moment");
    expect(task.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives up on a transient failure once the attempts run out", async () => {
    const id = givenTask({ attempts: 2 });
    const worker = createWorker({
      maxAttempts: 3,
      runTask: async () => {
        throw new TransientError("still unreachable");
      },
    });

    await worker.tick();
    await worker.drain();

    expect(taskById(id).state).toBe("failed");
    expect(taskById(id).attempts).toBe(3);
  });

  it("does not retry a failure that would just happen again", async () => {
    const id = givenTask();
    const worker = createWorker({
      runTask: async () => {
        throw new Error("The agent did not finish.");
      },
    });

    await worker.tick();
    await worker.drain();

    const task = taskById(id);
    expect(task.state).toBe("failed");
    expect(task.error).toBe("The agent did not finish.");
  });

  it("queues again what a dead worker abandoned", () => {
    const id = givenTask({
      state: "preparing",
      attempts: 1,
      leaseUntil: new Date(Date.now() - 1_000),
    });

    expect(createWorker({}).reap()).toBe(1);
    const task = taskById(id);
    expect(task.state).toBe("queued");
    expect(task.leaseUntil).toBeNull();
    expect(task.error).toContain("Loopable stopped");
  });

  it("fails an abandoned task that has run out of attempts", () => {
    const id = givenTask({
      state: "applying",
      attempts: 3,
      leaseUntil: new Date(Date.now() - 1_000),
    });

    createWorker({ maxAttempts: 3 }).reap();
    expect(taskById(id).state).toBe("failed");
  });

  it("leaves alone a task whose worker is still renewing its claim", () => {
    const id = givenTask({
      state: "preparing",
      attempts: 1,
      leaseUntil: new Date(Date.now() + 60_000),
    });

    expect(createWorker({}).reap()).toBe(0);
    expect(taskById(id).state).toBe("preparing");
  });

  /**
   * A person clicks Stop in the app, which is a different process, so the
   * request arrives as a column. The worker has to notice it while the run is
   * still going, which it does when it renews its claim.
   */
  it("notices a stop asked for by the other process", async () => {
    const id = givenTask();
    const worker = createWorker({
      leaseMs: 1_500,
      runTask: async (taskId, signal) => {
        db().update(tasks).set({ cancelRequested: true }).where(eq(tasks.id, taskId)).run();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        throw new TaskCancelled();
      },
    });

    await worker.tick();
    await worker.drain();

    const task = taskById(id);
    expect(task.state).toBe("cancelled");
    expect(task.error).toBe("Stopped before it finished.");
  });

  /**
   * Shutting down also aborts whatever is running, but nobody asked for those
   * to end, so they have to be waiting when the daemon comes back rather than
   * recorded as though a person stopped them.
   */
  it("queues again a run that only stopped because the daemon did", async () => {
    const id = givenTask();
    const worker = createWorker({
      runTask: async (_id, signal) => {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        throw new TaskCancelled();
      },
    });

    await worker.tick();
    await worker.stop(2_000);

    const task = taskById(id);
    expect(task.state).toBe("queued");
    expect(task.error).toContain("shutting down");
  });
});
