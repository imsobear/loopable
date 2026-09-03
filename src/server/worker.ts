import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { isTransient } from "#/connectors/errors.ts";
import { db } from "./db/client.ts";
import { tasks } from "./db/schema.ts";
import { runnerSettings } from "./settings.ts";
import { isCancellation, runTask, updateTask } from "./tasks.ts";

/** States where the worker still owes the task something. */
const CLAIMED_STATES = ["preparing", "applying"] as const;

export type WorkerOptions = {
  /** Swapped out in tests so a pass takes milliseconds instead of minutes. */
  runTask?: (id: string, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
  /** How long a claim survives without renewal. */
  leaseMs?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  log?: (message: string) => void;
};

export type Worker = ReturnType<typeof createWorker>;

export function createWorker(options: WorkerOptions = {}) {
  const execute = options.runTask ?? runTask;
  const now = options.now ?? (() => Date.now());
  const leaseMs = options.leaseMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const log = options.log ?? (() => {});

  const inFlight = new Map<string, { abort: AbortController; done: Promise<void> }>();
  let poll: ReturnType<typeof setInterval> | undefined;
  let stopping = false;

  /**
   * A claim that has stopped being renewed belonged to a process that is no
   * longer alive, so the task is nobody's and has to be picked up again.
   * Attempts are what keep a task that kills its worker from doing it forever.
   */
  function reap(): number {
    const abandoned = db()
      .select()
      .from(tasks)
      .where(
        and(
          inArray(tasks.state, [...CLAIMED_STATES]),
          or(isNull(tasks.leaseUntil), lte(tasks.leaseUntil, new Date(now()))),
        ),
      )
      .all()
      .filter((task) => !inFlight.has(task.id));

    for (const task of abandoned) {
      if (task.attempts < maxAttempts) {
        log(`requeue ${task.id}: its worker went away`);
        updateTask(task.id, {
          state: "queued",
          leaseUntil: null,
          runAfter: new Date(now()),
          error: "Loopable stopped while this was running, so it was queued again.",
        });
      } else {
        log(`fail ${task.id}: abandoned after ${task.attempts} attempts`);
        updateTask(task.id, {
          state: "failed",
          leaseUntil: null,
          error: "Loopable stopped while this was running, and it had run out of attempts.",
        });
      }
    }
    return abandoned.length;
  }

  /**
   * One statement, so two workers cannot take the same task: whoever changes
   * the row first is the one that owns it.
   */
  function claim(id: string): boolean {
    const at = now();
    const result = db()
      .update(tasks)
      .set({
        state: "preparing",
        leaseUntil: new Date(at + leaseMs),
        attempts: sql`${tasks.attempts} + 1`,
        startedAt: sql`coalesce(${tasks.startedAt}, ${at})`,
        updatedAt: new Date(at),
      })
      .where(and(eq(tasks.id, id), eq(tasks.state, "queued")))
      .run();
    return result.changes === 1;
  }

  /**
   * Renewing is also when a stop request is noticed: the person asking is in
   * the other process, so the database is where they leave the message.
   */
  function renew(id: string, abort: AbortController): void {
    const task = db().select().from(tasks).where(eq(tasks.id, id)).get();
    if (task?.cancelRequested) {
      abort.abort();
      return;
    }
    updateTask(id, { leaseUntil: new Date(now() + leaseMs) });
  }

  function backoffMs(attempts: number): number {
    return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  }

  function settle(id: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const task = db().select().from(tasks).where(eq(tasks.id, id)).get();
    const attempts = task?.attempts ?? maxAttempts;
    const started = task?.startedAt?.getTime() ?? task?.createdAt.getTime() ?? now();
    /** How long it went on for, which a person wants to know most when it did not work. */
    const durationMs = now() - started;

    if (isCancellation(error)) {
      // A run is also aborted when the daemon is shutting down, which is not
      // the same as a person stopping it: nobody asked for it to end, so it
      // goes back in the queue instead of being recorded as cancelled.
      if (task?.cancelRequested) {
        log(`cancelled ${id}`);
        updateTask(id, { state: "cancelled", error: message, leaseUntil: null, durationMs });
      } else {
        log(`requeue ${id}: stopped while shutting down`);
        updateTask(id, {
          state: "queued",
          leaseUntil: null,
          runAfter: new Date(now()),
          error: "Loopable was shutting down, so this was queued again.",
        });
      }
      return;
    }
    if (isTransient(error) && attempts < maxAttempts) {
      const wait = backoffMs(attempts);
      log(`retry ${id} in ${Math.round(wait / 1000)}s: ${message}`);
      updateTask(id, {
        state: "queued",
        leaseUntil: null,
        runAfter: new Date(now() + wait),
        error: message,
      });
      return;
    }
    log(`failed ${id}: ${message}`);
    updateTask(id, { state: "failed", error: message, leaseUntil: null, durationMs });
  }

  function launch(id: string): void {
    const abort = new AbortController();
    // Fast enough that Stop feels like a button, rather than as slow as the
    // lease it also renews. A one-row update every couple of seconds is
    // nothing next to what the agent is doing.
    const heartbeat = setInterval(() => renew(id, abort), Math.min(2_000, leaseMs / 3));

    const done = execute(id, abort.signal)
      .then(() => {
        log(`finished ${id}`);
      })
      .catch((error: unknown) => settle(id, error))
      .finally(() => {
        clearInterval(heartbeat);
        inFlight.delete(id);
      });

    inFlight.set(id, { abort, done });
  }

  /** One pass: clean up after the dead, then start what there is room for. */
  async function tick(): Promise<number> {
    reap();
    if (stopping) return 0;

    const { paused, maxConcurrentRuns } = runnerSettings();
    if (paused) return 0;
    const capacity = maxConcurrentRuns - inFlight.size;
    if (capacity <= 0) return 0;

    const waiting = db()
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.state, "queued"), lte(tasks.runAfter, new Date(now()))))
      .orderBy(asc(tasks.createdAt))
      .limit(capacity)
      .all();

    let started = 0;
    for (const task of waiting) {
      if (!claim(task.id)) continue;
      log(`started ${task.id}`);
      launch(task.id);
      started += 1;
    }
    return started;
  }

  /** Resolves once everything currently running has finished. */
  async function drain(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight.values()].map((entry) => entry.done));
    }
  }

  function start(): void {
    if (poll) return;
    void tick();
    poll = setInterval(() => void tick(), pollIntervalMs);
  }

  /**
   * Stops claiming and brings the running agents down with us. Walking away
   * instead would leave them running with nowhere to report, still spending
   * money, while the task they belong to gets queued again and starts a
   * second one alongside the first.
   */
  async function stop(graceMs = 15_000): Promise<void> {
    stopping = true;
    if (poll) clearInterval(poll);
    poll = undefined;
    if (inFlight.size === 0) return;

    log(`stopping ${inFlight.size} run(s)`);
    for (const entry of inFlight.values()) entry.abort.abort();
    await Promise.race([drain(), new Promise((resolve) => setTimeout(resolve, graceMs))]);
  }

  return { tick, drain, start, stop, reap, running: () => inFlight.size };
}
