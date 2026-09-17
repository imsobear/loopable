import { hostname as osHostname } from "node:os";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { jobRequiresHost, type AgentJob } from "./agent-job.ts";
import { db } from "./db/client.ts";
import { tasks } from "./db/schema.ts";
import { getRunner, heartbeatRunner, isRunnerOnline } from "./runners.ts";
import { runDir } from "./paths.ts";
import { absorbAgentOutput, jobForTask, taskRow, updateTask } from "./tasks.ts";
import type { RunnerInventoryEntry } from "#/lib/domain.ts";

export function claimAgentJob(runnerId: string): Promise<AgentJob | null> {
  const row = getRunner(runnerId);
  if (!row || !isRunnerOnline(row)) return Promise.resolve(null);

  const waiting = db()
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
    const claimed = db()
      .update(tasks)
      .set({ leaseUntil: new Date(Date.now() + 60_000), updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.state, "awaiting_agent")))
      .run();
    if (claimed.changes !== 1) continue;
    return jobForTask(task.id).then((job) => {
      if (jobRequiresHost(job) && row.hostname !== osHostname()) {
        updateTask(task.id, { leaseUntil: null });
        return null;
      }
      return job;
    });
  }
  return Promise.resolve(null);
}

export function appendAgentLog(taskId: string, runnerId: string, chunk: string): void {
  const task = taskRow(taskId);
  if (!task || task.runnerId !== runnerId) throw new Error("This run is not yours.");
  const path = task.logPath ?? join(runDir(taskId), "agent.log");
  if (!existsSync(path) && !task.logPath) updateTask(taskId, { logPath: path });
  appendFileSync(task.logPath ?? path, chunk);
}

export async function completeAgentJob(
  taskId: string,
  runnerId: string,
  result: { ok: boolean; output: string; detail?: string; aborted?: boolean; command: string },
) {
  const task = taskRow(taskId);
  if (!task || task.runnerId !== runnerId) throw new Error("This run is not yours.");
  updateTask(taskId, { agentCommand: result.command, leaseUntil: null });
  if (result.aborted) {
    updateTask(taskId, { state: "cancelled", error: "Stopped before it finished." });
    return;
  }
  if (!result.ok) {
    updateTask(taskId, { state: "failed", error: result.detail ?? "The agent did not finish." });
    return;
  }
  await absorbAgentOutput(taskId, result.output);
}

export function touchRunner(runnerId: string, inventory: RunnerInventoryEntry[]) {
  return heartbeatRunner(runnerId, inventory);
}
