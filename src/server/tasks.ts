import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { agentRuntime } from "#/agents/runtimes.ts";
import { connectorManifest } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type { WorkItem } from "#/connectors/types.ts";
import type { TaskView } from "#/lib/domain.ts";
import { listAgents, settingsFor } from "./agents.ts";
import { credentialForConnector } from "./connections.ts";
import { db } from "./db/client.ts";
import { runDir } from "./paths.ts";
import { rules, tasks, type Task } from "./db/schema.ts";

/**
 * The agent says this when the honest answer is "nothing". Without it a rule
 * that runs by itself would post filler, which is worse than silence.
 */
const NOTHING = "NOTHING_TO_DO";

/** Written work should say where it came from. */
const SIGNATURE = "\n\n---\n*Written by Loopable, running locally.*";

function toView(row: Task & { ruleName?: string | null }): TaskView {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName ?? "Deleted rule",
    connectorId: row.connectorId,
    state: row.state,
    sourceUrl: row.sourceUrl,
    sourceKind: row.sourceKind,
    sourceRepo: row.sourceRepo,
    sourceNumber: row.sourceNumber,
    sourceTitle: row.sourceTitle,
    dryRun: row.dryRun,
    agentId: row.agentId,
    agentCommand: row.agentCommand,
    output: row.output,
    actionId: row.actionId,
    resultUrl: row.resultUrl,
    error: row.error,
    attempts: row.attempts,
    cancelRequested: row.cancelRequested,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function select() {
  return db()
    .select({
      id: tasks.id,
      ruleId: tasks.ruleId,
      connectorId: tasks.connectorId,
      state: tasks.state,
      sourceUrl: tasks.sourceUrl,
      sourceKind: tasks.sourceKind,
      sourceRepo: tasks.sourceRepo,
      sourceNumber: tasks.sourceNumber,
      sourceTitle: tasks.sourceTitle,
      dryRun: tasks.dryRun,
      agentId: tasks.agentId,
      agentCommand: tasks.agentCommand,
      output: tasks.output,
      actionId: tasks.actionId,
      resultUrl: tasks.resultUrl,
      error: tasks.error,
      logPath: tasks.logPath,
      attempts: tasks.attempts,
      runAfter: tasks.runAfter,
      leaseUntil: tasks.leaseUntil,
      cancelRequested: tasks.cancelRequested,
      dedupeKey: tasks.dedupeKey,
      durationMs: tasks.durationMs,
      createdAt: tasks.createdAt,
      startedAt: tasks.startedAt,
      updatedAt: tasks.updatedAt,
      ruleName: rules.name,
    })
    .from(tasks)
    .leftJoin(rules, eq(tasks.ruleId, rules.id));
}

export function listTasks(options: { ruleId?: string; limit?: number } = {}): TaskView[] {
  const query = select().orderBy(desc(tasks.createdAt)).limit(options.limit ?? 100);
  const rows = options.ruleId ? query.where(eq(tasks.ruleId, options.ruleId)).all() : query.all();
  return rows.map(toView);
}

export function getTask(id: string): TaskView | null {
  const row = select().where(eq(tasks.id, id)).get();
  return row ? toView(row) : null;
}

export function taskRow(id: string): Task | undefined {
  return db().select().from(tasks).where(eq(tasks.id, id)).get();
}

export function updateTask(id: string, values: Partial<Task>): void {
  db()
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .run();
}

/**
 * Queues a run and returns at once. Identifying the link needs no network, so
 * a typo still fails while the person is looking at the box, but everything
 * that can be slow or can fail belongs to the worker.
 */
export function enqueueTask(input: {
  ruleId: string;
  url: string;
  dryRun: boolean;
}): TaskView {
  const rule = db().select().from(rules).where(eq(rules.id, input.ruleId)).get();
  if (!rule) throw new Error("Rule not found");

  const manifest = connectorManifest(rule.connectorId);
  if (!manifest) throw new Error(`Unknown connector: ${rule.connectorId}`);
  const runtime = connectorRuntime(rule.connectorId);
  if (!runtime.identifyLink || !runtime.resolveWorkItem || !runtime.applyAction) {
    throw new Error(`${manifest.name} cannot run tasks yet.`);
  }

  const ref = runtime.identifyLink(input.url);
  if (!ref) {
    throw new Error(`That does not look like a ${manifest.name} link Loopable can work on.`);
  }

  const id = randomUUID();
  db()
    .insert(tasks)
    .values({
      id,
      ruleId: rule.id,
      connectorId: rule.connectorId,
      state: "queued",
      sourceUrl: input.url.trim(),
      sourceKind: ref.kind,
      sourceRepo: ref.repo,
      sourceNumber: ref.number,
      dryRun: input.dryRun,
      actionId: rule.actionId,
    })
    .run();
  return getTask(id)!;
}

export function requestCancel(id: string): TaskView | null {
  const row = taskRow(id);
  if (!row) return null;
  updateTask(id, { cancelRequested: true });
  return getTask(id);
}

export class TaskCancelled extends Error {
  constructor() {
    super("Stopped before it finished.");
    this.name = "Cancelled";
  }
}

/**
 * Matched by name rather than by class. The app and the daemon load their own
 * copy of every module, so instanceof cannot be relied on to travel.
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof TaskCancelled || (error as Error | null)?.name === "Cancelled";
}

function promptFor(input: { instruction: string; item: WorkItem; files: string[] }): string {
  return [
    `You are working on ${input.item.repo} ${input.item.kind === "pull_request" ? "pull request" : "issue"} #${input.item.number}.`,
    `Read ${input.files.join(" and ")} in this directory first.`,
    ``,
    `Your task:`,
    input.instruction,
    ``,
    `Reply with only the text to post. No preamble, no explanation of what you are about to do.`,
    `If there is genuinely nothing worth posting, reply with exactly ${NOTHING}.`,
  ].join("\n");
}

/**
 * Carries one queued task as far as it can get. Throws so the worker can
 * decide whether to try again; what it must never do is repeat the agent,
 * which is the only expensive part. Once output is stored, a retry picks up at
 * the write.
 */
export async function runTask(id: string, signal?: AbortSignal): Promise<TaskView> {
  const task = taskRow(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  const stop = () => {
    if (signal?.aborted || taskRow(id)?.cancelRequested) throw new TaskCancelled();
  };

  const rule = db().select().from(rules).where(eq(rules.id, task.ruleId)).get();
  if (!rule) throw new Error("The rule behind this task has been deleted.");
  const runtime = connectorRuntime(task.connectorId);
  if (!runtime.resolveWorkItem || !runtime.applyAction) {
    throw new Error(`${task.connectorId} cannot run tasks.`);
  }

  stop();
  const { credential } = await credentialForConnector(task.connectorId);
  const item = await runtime.resolveWorkItem({ url: task.sourceUrl, credential });
  updateTask(id, { sourceTitle: item.title });

  let output = task.output;
  if (!output) {
    stop();
    const agentId = task.agentId ?? (await defaultAgentFor(rule.agentId));
    updateTask(id, { state: "preparing", agentId });

    const workspace = runDir(id);
    for (const file of item.context) {
      writeFileSync(join(workspace, file.name), file.body);
    }

    const result = await agentRuntime(agentId).run({
      prompt: promptFor({
        instruction: rule.instruction,
        item,
        files: item.context.map((file) => file.name),
      }),
      cwd: workspace,
      settings: settingsFor(agentId),
      outputFile: join(workspace, "answer.txt"),
    });
    updateTask(id, { agentCommand: result.command });

    if (!result.ok) {
      // Never transient: the same prompt and the same timeout would fail again.
      throw new Error(result.detail ?? "The agent did not finish.");
    }
    output = result.output.trim();
    if (!output) throw new Error("The agent produced nothing.");

    if (output.replace(/[`*_.\s]/g, "").toUpperCase() === NOTHING) {
      finish(id, task, { state: "skipped", output });
      return getTask(id)!;
    }
    updateTask(id, { output });
  }

  if (task.dryRun) {
    finish(id, task, { state: "prepared" });
    return getTask(id)!;
  }

  stop();
  updateTask(id, { state: "applying" });
  const outcome = await runtime.applyAction({
    actionId: task.actionId,
    item,
    body: output + SIGNATURE,
    credential,
  });
  finish(id, task, { state: "done", resultUrl: outcome.url });
  return getTask(id)!;
}

function finish(id: string, task: Task, values: Partial<Task>): void {
  const started = task.startedAt?.getTime() ?? task.createdAt.getTime();
  updateTask(id, { ...values, durationMs: Date.now() - started, leaseUntil: null });
}

async function defaultAgentFor(pinned: string | null): Promise<string> {
  const agents = await listAgents();
  const chosen = pinned ?? agents.find((agent) => agent.isDefault)?.agentId ?? null;
  if (!chosen) throw new Error("No agent is available. Choose a default on the Agents page.");
  if (!agentManifest(chosen)) throw new Error(`Unknown agent: ${chosen}`);
  if (!agents.find((agent) => agent.agentId === chosen)?.installed) {
    throw new Error(`${chosen} is not installed on this machine.`);
  }
  return chosen;
}
