import { and, asc, eq, inArray } from "drizzle-orm";
import { connectorManifest, connectorWorkflow } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type { Signal } from "#/connectors/types.ts";
import type { BacklogItem, RulePollState } from "#/lib/domain.ts";
import { credentialForConnector } from "./connections.ts";
import { db } from "./db/client.ts";
import { rules, signals, type Rule } from "./db/schema.ts";
import { enqueueSignal } from "./tasks.ts";

export type PollReport = {
  ruleId: string;
  ruleName: string;
  /** How many things the connector said match right now. */
  found: number;
  queued: number;
  backlog: number;
  held: number;
  superseded: number;
  error: string | null;
};

/**
 * Two rules can want the same pull request. Only the first one gets it, so
 * this is what one rule tells the next about what it has taken.
 */
function claimOf(rule: Rule, signal: Signal): string {
  return `${rule.connectorId}:${signal.repo}#${signal.number}`;
}

/**
 * One look at what a rule is watching for.
 *
 * The first look never acts. Whatever is already waiting when a rule is
 * created is that rule's backlog, and running an agent over a review queue
 * that has been piling up for a month is not what someone turning on a rule
 * is asking for. It is recorded rather than discarded, so it can still be run
 * on purpose afterwards.
 */
export async function pollRule(rule: Rule, claimed: Set<string>): Promise<PollReport> {
  const report: PollReport = {
    ruleId: rule.id,
    ruleName: rule.name,
    found: 0,
    queued: 0,
    backlog: 0,
    held: 0,
    superseded: 0,
    error: null,
  };

  try {
    const manifest = connectorManifest(rule.connectorId);
    if (!manifest) throw new Error(`Unknown connector: ${rule.connectorId}`);
    const workflow = connectorWorkflow(rule.connectorId, rule.workflowId);
    if (!workflow) throw new Error(`${manifest.name} no longer offers ${rule.workflowId}.`);
    const runtime = connectorRuntime(rule.connectorId);
    if (!runtime.poll) throw new Error(`${manifest.name} cannot watch for anything yet.`);

    const { credential } = await credentialForConnector(rule.connectorId);
    // Settings a rule was saved before are missing rather than false, so the
    // connector fills the gaps from what the workflow declares.
    const found = await runtime.poll({
      workflowId: rule.workflowId,
      settings: rule.settings,
      credential,
    });
    report.found = found.length;

    const known = new Set(
      db()
        .select({ key: signals.key })
        .from(signals)
        .where(eq(signals.ruleId, rule.id))
        .all()
        .map((row) => row.key),
    );
    const first = rule.polledAt === null;

    for (const signal of found) {
      const claim = claimOf(rule, signal);
      // Something this rule has already dealt with still counts as taken, or
      // a rule further down the list would pick up its leftovers.
      if (known.has(signal.key)) {
        claimed.add(claim);
        continue;
      }

      // Being taken settles it before any other reason, including a hold or a
      // first look: the same thing sitting in two rules' lists would be run
      // twice by whoever works through them.
      const outcome = claimed.has(claim)
        ? "superseded"
        : signal.hold
          ? "held"
          : first
            ? "backlog"
            : "queued";
      const task = outcome === "queued" ? enqueueSignal({ rule, signal }) : null;
      db()
        .insert(signals)
        .values({
          ruleId: rule.id,
          key: signal.key,
          outcome,
          sourceKind: signal.kind,
          sourceRepo: signal.repo,
          sourceNumber: signal.number,
          sourceTitle: signal.title,
          sourceUrl: signal.url,
          hold: signal.hold,
          taskId: task?.id,
        })
        .onConflictDoNothing()
        .run();

      claimed.add(claim);
      report[outcome] += 1;
    }

    db()
      .update(rules)
      .set({ polledAt: new Date(), pollError: null })
      .where(eq(rules.id, rule.id))
      .run();
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    // polledAt is deliberately left alone: a look that failed told us nothing
    // about the backlog, and moving the mark would silently swallow it.
    db().update(rules).set({ pollError: report.error }).where(eq(rules.id, rule.id)).run();
  }

  return report;
}

/**
 * Every enabled rule, in the order a person put them in, because that order is
 * what decides who gets a thing two rules both want.
 */
export async function pollAllRules(): Promise<PollReport[]> {
  const enabled = db()
    .select()
    .from(rules)
    .where(eq(rules.enabled, true))
    .orderBy(asc(rules.priority))
    .all();

  const claimed = new Set<string>();
  const reports: PollReport[] = [];
  for (const rule of enabled) {
    reports.push(await pollRule(rule, claimed));
  }
  return reports;
}

function toBacklogItem(row: typeof signals.$inferSelect): BacklogItem {
  return {
    key: row.key,
    sourceKind: row.sourceKind,
    sourceRepo: row.sourceRepo,
    sourceNumber: row.sourceNumber,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    hold: row.hold,
    seenAt: row.seenAt.toISOString(),
  };
}

/**
 * Everything a rule has noticed and never acted on, whether it was already
 * waiting when the rule was made or the connector held it back. They are one
 * list because they are one question: this was asked of you and nothing has
 * happened, do you want it run?
 */
const WAITING = ["backlog", "held"] as const;

/** What the rule page needs to say whether the rule is actually watching. */
export function rulePollState(ruleId: string): RulePollState {
  const rule = db().select().from(rules).where(eq(rules.id, ruleId)).get();
  const backlog = db()
    .select()
    .from(signals)
    .where(and(eq(signals.ruleId, ruleId), inArray(signals.outcome, [...WAITING])))
    .orderBy(asc(signals.sourceRepo), asc(signals.sourceNumber))
    .all();
  return {
    polledAt: rule?.polledAt?.toISOString() ?? null,
    pollError: rule?.pollError ?? null,
    backlog: backlog.map(toBacklogItem),
  };
}

/**
 * Run everything the rule is holding. Asked for explicitly, because it is the
 * one moment a rule does a month of work at once, and because something held
 * back for being too big is being run against the connector's advice.
 */
export function runBacklog(ruleId: string): number {
  const rule = db().select().from(rules).where(eq(rules.id, ruleId)).get();
  if (!rule) throw new Error("Rule not found");

  const waiting = db()
    .select()
    .from(signals)
    .where(and(eq(signals.ruleId, ruleId), inArray(signals.outcome, [...WAITING])))
    .all();

  for (const row of waiting) {
    const task = enqueueSignal({
      rule,
      signal: {
        key: row.key,
        kind: row.sourceKind,
        repo: row.sourceRepo,
        number: row.sourceNumber,
        title: row.sourceTitle,
        url: row.sourceUrl,
      },
    });
    db()
      .update(signals)
      .set({ outcome: "queued", taskId: task.id })
      .where(and(eq(signals.ruleId, ruleId), eq(signals.key, row.key)))
      .run();
  }
  return waiting.length;
}
