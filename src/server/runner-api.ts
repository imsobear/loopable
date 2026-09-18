import { hostname as osHostname } from "node:os";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { isHosted } from "#/lib/hosted.ts";
import { jobRequiresHost, type AgentJob } from "./agent-job.ts";
import { db, rowsChanged } from "./db/client.ts";
import { tasks } from "./db/schema.ts";
import { getRunner, heartbeatRunner, isRunnerOnline } from "./runners.ts";
import { runDir } from "./paths.ts";
import { absorbAgentOutput, jobForTask, taskRow, updateTask } from "./tasks.ts";
import type { RunnerInventoryEntry } from "#/lib/domain.ts";

export async function claimAgentJob(runnerId: string): Promise<AgentJob | null> {
  const row = await getRunner(runnerId);
  if (!row || !isRunnerOnline(row)) return null;

  const waiting = await db()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.state, "awaiting_agent"),
        eq(tasks.runnerId, runnerId),
        or(isNull(tasks.leaseUntil), lte(tasks.leaseUntil, new Date())),
      ),
    )
    .all();

  for (const task of waiting) {
    const claimed = await db()
      .update(tasks)
      .set({ leaseUntil: new Date(Date.now() + 60_000), updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.state, "awaiting_agent")))
      .run();
    if (rowsChanged(claimed) !== 1) continue;
    const job = await jobForTask(task.id);
    if (jobRequiresHost(job) && row.hostname !== osHostname()) {
      await updateTask(task.id, { leaseUntil: null });
      return null;
    }
    return job;
  }
  return null;
}

export async function appendAgentLog(taskId: string, runnerId: string, chunk: string): Promise<void> {
  const task = await taskRow(taskId);
  if (!task || task.runnerId !== runnerId) throw new Error("This run is not yours.");
  const next = `${task.logText ?? ""}${chunk}`;
  if (isHosted()) {
    await updateTask(taskId, { logText: next });
    return;
  }
  const path = task.logPath ?? join(runDir(taskId), "agent.log");
  if (!existsSync(path) && !task.logPath) {
    await updateTask(taskId, { logPath: path, logText: next });
  } else {
    await updateTask(taskId, { logText: next });
  }
  appendFileSync(task.logPath ?? path, chunk);
}

export async function completeAgentJob(
  taskId: string,
  runnerId: string,
  result: { ok: boolean; output: string; detail?: string; aborted?: boolean; command: string },
) {
  const task = await taskRow(taskId);
  if (!task || task.runnerId !== runnerId) throw new Error("This run is not yours.");
  await updateTask(taskId, { agentCommand: result.command, leaseUntil: null });
  if (result.aborted) {
    await updateTask(taskId, { state: "cancelled", error: "Stopped before it finished." });
    return;
  }
  if (!result.ok) {
    await updateTask(taskId, { state: "failed", error: result.detail ?? "The agent did not finish." });
    return;
  }
  await absorbAgentOutput(taskId, result.output);
}

export function touchRunner(runnerId: string, inventory: RunnerInventoryEntry[]) {
  return heartbeatRunner(runnerId, inventory);
}
