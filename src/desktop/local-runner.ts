import { mkdtempSync, rmSync } from "node:fs";
import { hostname as osHostname, tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents } from "#/agents/inventory.ts";
import { RUNNER_PROTOCOL, VERSION } from "#/lib/version.ts";
import { runAgentJob } from "#/server/agent-runner.ts";
import { appendAgentLog, claimAgentJob, completeAgentJob } from "#/server/runner-api.ts";
import { getJoinToken, heartbeatRunner, instructionFor, joinRunner } from "#/server/runners.ts";
import { taskRow } from "#/server/tasks.ts";
import { watchFile } from "./watch-file.ts";

const BUILD = { version: VERSION, protocol: RUNNER_PROTOCOL, updatable: false };

/**
 * The runner of the desktop app, in the same process as the dispatcher. It
 * is the runner in src/runner/client.ts with the HTTP taken out: it joins,
 * heartbeats, claims and completes through the same functions the API routes
 * call, so what the database sees is one runner on this machine, as the
 * Runners page always showed.
 *
 * It never updates itself: the app updates, and the engine with it.
 */
export function startLocalRunner(input: { log: (message: string) => void }) {
  let stopping = false;
  let current: AbortController | null = null;
  let runnerId: string | null = null;

  async function joinHere(): Promise<string> {
    const hello = await joinRunner({
      joinToken: await getJoinToken(),
      hostname: osHostname(),
      inventory: await detectAgents(),
      ...BUILD,
    });
    input.log(`runner joined as ${hello.name} (${hello.runnerId})`);
    return hello.runnerId;
  }

  async function heartbeat(): Promise<void> {
    if (!runnerId) return;
    await heartbeatRunner(runnerId, await detectAgents(), BUILD);
    const instruction = await instructionFor(runnerId);
    // Forgotten from the app is a fresh start, not an end: this machine is
    // the only runner there is here.
    if (instruction?.kind === "stop") runnerId = null;
  }

  async function runOne(id: string): Promise<boolean> {
    const job = await claimAgentJob(id);
    if (!job) return false;
    input.log(`running ${job.taskId}`);
    const workspace = mkdtempSync(join(tmpdir(), `loopable-${job.taskId}-`));
    const controller = new AbortController();
    current = controller;
    const stopLog = watchFile(join(workspace, "agent.log"), (chunk) => {
      void appendAgentLog(job.taskId, id, chunk).catch((error: unknown) => {
        input.log(`log failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    // A Stop pressed in the app leaves a note on the task; this is who reads
    // it, since the agent is a child of this process.
    const watchCancel = setInterval(() => {
      void taskRow(job.taskId).then((row) => {
        if (row?.cancelRequested) controller.abort();
      });
    }, 2_000);
    try {
      const result = await runAgentJob(job, { workspace, signal: controller.signal });
      await completeAgentJob(job.taskId, id, result);
    } finally {
      clearInterval(watchCancel);
      stopLog();
      current = null;
      rmSync(workspace, { recursive: true, force: true });
    }
    return true;
  }

  async function loop(): Promise<void> {
    let beatAt = 0;
    while (!stopping) {
      try {
        if (!runnerId) runnerId = await joinHere();
        if (Date.now() - beatAt > 15_000) {
          await heartbeat();
          beatAt = Date.now();
          if (!runnerId) continue;
        }
        const ran = await runOne(runnerId);
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 1_000));
      } catch (error) {
        input.log(`runner: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  const done = loop();

  return {
    async stop(): Promise<void> {
      stopping = true;
      current?.abort();
      await done;
    },
  };
}
