import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { connectorManifest, connectorWorkflow } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type { Signal } from "#/connectors/types.ts";
import type { BacklogItem, LoopPollState } from "#/lib/domain.ts";
import { credentialForConnector } from "./connections.ts";
import { db } from "./db/client.ts";
import { loops, signals, type Loop } from "./db/schema.ts";
import { defaultAgentFor, enqueueSignal } from "./tasks.ts";
import { triage, type Triage } from "./triage.ts";

export type PollReport = {
  loopId: string;
  loopName: string;
  /** How many things the connector said match right now. */
  found: number;
  queued: number;
  backlog: number;
  held: number;
  superseded: number;
  /** How many a single triage run saved from being a run of their own. */
  triaged: number;
  error: string | null;
};

/** A setting a loop was saved before existing is missing, which is not false. */
function boolean(value: unknown): boolean {
  return value === true;
}

/**
 * Two loops can want the same pull request. Only the first one gets it, so
 * this is what one loop tells the next about what it has taken.
 */
function claimOf(loop: Loop, signal: Signal): string {
  return `${loop.connectorId}:${signal.ref}`;
}

/**
 * One look at what a loop is watching for.
 *
 * The first look never acts. Whatever is already waiting when a loop is
 * created is that loop's backlog, and running an agent over a review queue
 * that has been piling up for a month is not what someone turning on a loop
 * is asking for. It is recorded rather than discarded, so it can still be run
 * on purpose afterwards.
 */
export async function pollLoop(loop: Loop, claimed: Set<string>): Promise<PollReport> {
  const report: PollReport = {
    loopId: loop.id,
    loopName: loop.name,
    found: 0,
    queued: 0,
    backlog: 0,
    held: 0,
    superseded: 0,
    triaged: 0,
    error: null,
  };

  try {
    const manifest = connectorManifest(loop.connectorId);
    if (!manifest) throw new Error(`Unknown connector: ${loop.connectorId}`);
    const workflow = connectorWorkflow(loop.connectorId, loop.workflowId);
    if (!workflow) throw new Error(`${manifest.name} no longer offers ${loop.workflowId}.`);
    const runtime = connectorRuntime(loop.connectorId);
    if (!runtime.poll) throw new Error(`${manifest.name} cannot watch for anything yet.`);

    const { credential } = await credentialForConnector(loop.connectorId);
    // Settings a loop was saved before are missing rather than false, so the
    // connector fills the gaps from what the workflow declares.
    const answer = await runtime.poll({
      workflowId: loop.workflowId,
      settings: loop.settings,
      credential,
      cursor: loop.pollCursor ?? null,
    });
    const found = answer.signals;
    report.found = found.length;

    const known = new Set(
      db()
        .select({ key: signals.key })
        .from(signals)
        .where(eq(signals.loopId, loop.id))
        .all()
        .map((row) => row.key),
    );
    const first = loop.polledAt === null;

    // What would otherwise become a run each. Asked about together, before any
    // of them is paid for, and only when there is something to save: a first
    // look is going to the backlog regardless, and a connector that already
    // held something has said more about it than this can.
    let judged: Triage = new Map();
    if (!first && boolean(loop.settings.needsMeOnly)) {
      const fresh = found.filter(
        (signal) =>
          !known.has(signal.key) && !signal.hold && !claimed.has(claimOf(loop, signal)),
      );
      judged = await triage({
        signals: fresh,
        agentId: await defaultAgentFor(loop.agentId),
        guidance: loop.guidance,
        cwd: mkdtempSync(join(tmpdir(), "loopable-triage-")),
      });
    }

    for (const signal of found) {
      const claim = claimOf(loop, signal);
      // Something this loop has already dealt with still counts as taken, or
      // a loop further down the list would pick up its leftovers.
      if (known.has(signal.key)) {
        claimed.add(claim);
        continue;
      }

      // Being taken settles it before any other reason, including a hold or a
      // first look: the same thing sitting in two loops' lists would be run
      // twice by whoever works through them.
      const hold = signal.hold ?? judged.get(signal.key);
      const outcome = claimed.has(claim)
        ? "superseded"
        : hold
          ? "held"
          : first
            ? "backlog"
            : "queued";
      const task = outcome === "queued" ? enqueueSignal({ loop, signal }) : null;
      db()
        .insert(signals)
        .values({
          loopId: loop.id,
          key: signal.key,
          outcome,
          sourceKind: signal.kind,
          sourceRef: signal.ref,
          sourceTitle: signal.title,
          sourceUrl: signal.url,
          hold,
          sourcePayload: signal.payload,
          taskId: task?.id,
        })
        .onConflictDoNothing()
        .run();

      claimed.add(claim);
      report[outcome] += 1;
      // Counted where it is decided, not from what triage returned: an item it
      // set aside can still be settled by something with precedence, and this
      // number is shown.
      if (outcome === "held" && !signal.hold) report.triaged += 1;
    }

    // The cursor moves only once everything the last answer carried is on
    // disk. A stream will not hand those messages over twice, so saving the
    // new position before the signals would lose whatever fell in between.
    db()
      .update(loops)
      .set({
        polledAt: new Date(),
        pollError: null,
        ...(answer.cursor !== undefined ? { pollCursor: answer.cursor } : {}),
      })
      .where(eq(loops.id, loop.id))
      .run();
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    // polledAt is deliberately left alone: a look that failed told us nothing
    // about the backlog, and moving the mark would silently swallow it.
    db().update(loops).set({ pollError: report.error }).where(eq(loops.id, loop.id)).run();
  }

  return report;
}

/**
 * Every enabled loop, in the order a person put them in, because that order is
 * what decides who gets a thing two loops both want.
 */
export async function pollAllLoops(): Promise<PollReport[]> {
  const enabled = db()
    .select()
    .from(loops)
    .where(eq(loops.enabled, true))
    .orderBy(asc(loops.priority))
    .all();

  const claimed = new Set<string>();
  const reports: PollReport[] = [];
  for (const loop of enabled) {
    reports.push(await pollLoop(loop, claimed));
  }
  return reports;
}

function toBacklogItem(row: typeof signals.$inferSelect): BacklogItem {
  return {
    key: row.key,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    hold: row.hold,
    seenAt: row.seenAt.toISOString(),
  };
}

/**
 * Everything a loop has noticed and never acted on, whether it was already
 * waiting when the loop was made or the connector held it back. They are one
 * list because they are one question: this was asked of you and nothing has
 * happened, do you want it run?
 */
const WAITING = ["backlog", "held"] as const;

/** What the loop page needs to say whether the loop is actually watching. */
export function loopPollState(loopId: string): LoopPollState {
  const loop = db().select().from(loops).where(eq(loops.id, loopId)).get();
  const backlog = db()
    .select()
    .from(signals)
    .where(and(eq(signals.loopId, loopId), inArray(signals.outcome, [...WAITING])))
    .orderBy(asc(signals.sourceRef))
    .all();
  return {
    polledAt: loop?.polledAt?.toISOString() ?? null,
    pollError: loop?.pollError ?? null,
    backlog: backlog.map(toBacklogItem),
  };
}

/**
 * Run everything the loop is holding. Asked for explicitly, because it is the
 * one moment a loop does a month of work at once, and because something held
 * back for being too big is being run against the connector's advice.
 */
export function runBacklog(loopId: string): number {
  const loop = db().select().from(loops).where(eq(loops.id, loopId)).get();
  if (!loop) throw new Error("Loop not found");

  const waiting = db()
    .select()
    .from(signals)
    .where(and(eq(signals.loopId, loopId), inArray(signals.outcome, [...WAITING])))
    .all();

  for (const row of waiting) {
    const task = enqueueSignal({
      loop,
      signal: {
        key: row.key,
        kind: row.sourceKind,
        ref: row.sourceRef,
        title: row.sourceTitle,
        url: row.sourceUrl,
        payload: row.sourcePayload ?? undefined,
      },
    });
    db()
      .update(signals)
      .set({ outcome: "queued", taskId: task.id })
      .where(and(eq(signals.loopId, loopId), eq(signals.key, row.key)))
      .run();
  }
  return waiting.length;
}
