import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { detectAgents } from "#/agents/inventory.ts";
import { runAgentJob } from "#/server/agent-runner.ts";
import type { AgentJob } from "#/server/agent-job.ts";
import { RUNNER_PROTOCOL, VERSION } from "#/lib/version.ts";
import { install, isUpdatable, restart } from "./update.ts";

type Hello = { runnerId: string; runnerToken: string; name: string };

/** What Loopable asks of this runner; see RunnerInstruction on the App's side. */
type Instruction = { kind: "stop"; reason: string } | { kind: "update"; version: string };

/** Said on joining and on every heartbeat, so the App knows which jobs this can take. */
const BUILD = { version: VERSION, protocol: RUNNER_PROTOCOL, updatable: isUpdatable() };

async function json(url: string, token: string, path: string, body: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text };
  }
  if (!res.ok) {
    const error = (parsed as { error?: string } | null)?.error ?? res.statusText;
    throw new Error(error);
  }
  return parsed;
}

function watchLog(path: string, onChunk: (chunk: string) => void): () => void {
  let offset = 0;
  const flush = () => {
    if (!existsSync(path)) return;
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      if (size <= offset) return;
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      onChunk(buf.toString("utf8"));
    } finally {
      closeSync(fd);
    }
  };
  const timer = setInterval(flush, 400);
  return () => {
    clearInterval(timer);
    flush();
  };
}

/**
 * Joining, again until it works: Loopable restarting, a network blip or a busy
 * database is not a reason for a runner to give up. A token Loopable does not
 * know is, because waiting will not change it.
 */
async function joinLoopable(
  url: string,
  joinToken: string,
  inventory: Awaited<ReturnType<typeof detectAgents>>,
  log: (m: string) => void,
): Promise<Hello> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await json(url, joinToken, "/api/runners/hello", {
        hostname: osHostname(),
        inventory,
        ...BUILD,
      })) as Hello;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/join token is not valid/i.test(message)) throw error;
      const wait = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
      log(`could not join (${message.split("\n")[0]}); trying again in ${Math.round(wait / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

export async function runRemoteLoop(input: { url: string; joinToken: string; log: (m: string) => void }) {
  const url = input.url.replace(/\/$/, "");
  const inventory = await detectAgents();
  const hello = await joinLoopable(url, input.joinToken, inventory, input.log);
  input.log(`joined as ${hello.name} (${hello.runnerId})`);
  const token = hello.runnerToken;
  // Why the last update failed, told to Loopable once on the next heartbeat.
  let updateError: string | null = null;
  let pending: Instruction | null = null;

  async function heartbeat() {
    const answer = (await json(url, token, "/api/runners/heartbeat", {
      inventory: await detectAgents(),
      ...BUILD,
      ...(updateError ? { updateError } : {}),
    })) as { instruction?: Instruction | null };
    updateError = null;
    if (answer?.instruction) pending = answer.instruction;
  }

  let stopping = false;
  const shutdown = () => {
    stopping = true;
    clearInterval(beat);
  };

  /** A runner Loopable no longer knows has nothing to do but stop. */
  const forgotten = (error: unknown) => /unknown runner/i.test(error instanceof Error ? error.message : String(error));

  /** Carried out between jobs, never in the middle of one. */
  function follow(instruction: Instruction): void {
    if (instruction.kind === "stop") {
      input.log(`${instruction.reason} Stopping. Run loopable runner to join again.`);
      shutdown();
      return;
    }
    input.log(`updating to loopable-cli ${instruction.version}`);
    const failed = install(instruction.version);
    if (failed) {
      updateError = failed;
      input.log(`update failed: ${failed}`);
      return;
    }
    input.log(`updated to ${instruction.version}; restarting`);
    shutdown();
    restart();
  }

  await heartbeat();
  const beat = setInterval(() => void heartbeat().catch((error: unknown) => {
    if (forgotten(error)) {
      pending = { kind: "stop", reason: "This runner is no longer in Loopable." };
      return;
    }
    input.log(`heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
  }), 15_000);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    if (pending) {
      const instruction = pending;
      pending = null;
      follow(instruction);
      continue;
    }
    try {
      const claimed = (await json(url, token, "/api/runners/claim", {})) as {
        job: AgentJob | null;
        instruction?: Instruction;
      };
      if (claimed.instruction) {
        pending = claimed.instruction;
        continue;
      }
      if (!claimed.job) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const job = claimed.job;
      input.log(`running ${job.taskId}`);
      const workspace = mkdtempSync(join(tmpdir(), `loopable-${job.taskId}-`));
      const stopLog = watchLog(join(workspace, "agent.log"), (chunk) => {
        void json(url, token, `/api/runners/jobs/${job.taskId}/log`, { chunk }).catch((error: unknown) => {
          input.log(`log failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      });
      try {
        const result = await runAgentJob(job, { workspace });
        await json(url, token, `/api/runners/jobs/${job.taskId}/complete`, result);
      } finally {
        stopLog();
        rmSync(workspace, { recursive: true, force: true });
      }
    } catch (error) {
      if (forgotten(error)) {
        pending = { kind: "stop", reason: "This runner is no longer in Loopable." };
        continue;
      }
      input.log(`claim failed: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
