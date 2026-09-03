import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { agentRuntime } from "#/agents/runtimes.ts";
import { connectorManifest } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type { WorkItem } from "#/connectors/types.ts";
import type { TaskState, TaskView } from "#/lib/domain.ts";
import { listAgents, settingsFor } from "./agents.ts";
import { credentialForConnector } from "./connections.ts";
import { db } from "./db/client.ts";
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
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
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
      durationMs: tasks.durationMs,
      createdAt: tasks.createdAt,
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

function update(id: string, values: Partial<Task>): void {
  db()
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .run();
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
 * Runs one rule against one thing, start to finish: fetch the context, let the
 * agent work, then write the result back unless this was a dry run or the
 * agent had nothing to say.
 */
export async function runRuleAgainstUrl(input: {
  ruleId: string;
  url: string;
  dryRun: boolean;
}): Promise<TaskView> {
  const rule = db().select().from(rules).where(eq(rules.id, input.ruleId)).get();
  if (!rule) throw new Error("Rule not found");

  const manifest = connectorManifest(rule.connectorId);
  if (!manifest) throw new Error(`Unknown connector: ${rule.connectorId}`);
  const runtime = connectorRuntime(rule.connectorId);
  if (!runtime.resolveWorkItem || !runtime.applyAction) {
    throw new Error(`${manifest.name} cannot run tasks yet.`);
  }

  // Resolving happens before the row exists, so a bad link is a plain error
  // rather than a failed task cluttering the record.
  const { credential } = await credentialForConnector(rule.connectorId);
  const item = await runtime.resolveWorkItem({ url: input.url, credential });

  const agents = await listAgents();
  const chosen = rule.agentId ?? agents.find((agent) => agent.isDefault)?.agentId ?? null;
  if (!chosen) throw new Error("No agent is available. Choose a default on the Agents page.");
  if (!agentManifest(chosen)) throw new Error(`Unknown agent: ${chosen}`);
  if (!agents.find((agent) => agent.agentId === chosen)?.installed) {
    throw new Error(`${chosen} is not installed on this machine.`);
  }

  const id = randomUUID();
  db()
    .insert(tasks)
    .values({
      id,
      ruleId: rule.id,
      connectorId: rule.connectorId,
      state: "preparing",
      sourceUrl: item.url,
      sourceKind: item.kind,
      sourceRepo: item.repo,
      sourceNumber: item.number,
      sourceTitle: item.title,
      dryRun: input.dryRun,
      agentId: chosen,
      actionId: rule.actionId,
    })
    .run();

  const started = Date.now();
  const fail = (message: string): TaskView => {
    update(id, { state: "failed", error: message, durationMs: Date.now() - started });
    return getTask(id)!;
  };

  try {
    const workspace = mkdtempSync(join(tmpdir(), "loopable-task-"));
    for (const file of item.context) {
      writeFileSync(join(workspace, file.name), file.body);
    }

    const settings = settingsFor(chosen);
    const prompt = promptFor({
      instruction: rule.instruction,
      item,
      files: item.context.map((file) => file.name),
    });
    const result = await agentRuntime(chosen).run({
      prompt,
      cwd: workspace,
      settings,
      outputFile: join(workspace, "answer.txt"),
    });
    update(id, { agentCommand: result.command });

    if (!result.ok) {
      return fail(result.detail ?? "The agent did not finish.");
    }
    const output = result.output.trim();
    if (!output) return fail("The agent produced nothing.");

    if (output.replace(/[`*_.\s]/g, "").toUpperCase() === NOTHING) {
      update(id, { state: "skipped", output, durationMs: Date.now() - started });
      return getTask(id)!;
    }

    update(id, { output });

    if (input.dryRun) {
      update(id, { state: "prepared", durationMs: Date.now() - started });
      return getTask(id)!;
    }

    update(id, { state: "applying" });
    const outcome = await runtime.applyAction({
      actionId: rule.actionId,
      item,
      body: output + SIGNATURE,
      credential,
    });
    update(id, { state: "done", resultUrl: outcome.url, durationMs: Date.now() - started });
    return getTask(id)!;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  queued: "Queued",
  preparing: "Working",
  applying: "Writing",
  prepared: "Prepared",
  done: "Written",
  skipped: "Nothing to say",
  failed: "Failed",
};
