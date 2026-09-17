import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { detectAgents } from "#/agents/inventory.ts";
import { runAgentJob } from "#/server/agent-runner.ts";
import type { AgentJob } from "#/server/agent-job.ts";

type Hello = { runnerId: string; runnerToken: string; name: string };

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

export async function runRemoteLoop(input: { url: string; joinToken: string; log: (m: string) => void }) {
  const url = input.url.replace(/\/$/, "");
  const inventory = await detectAgents();
  const hello = (await json(url, input.joinToken, "/api/runners/hello", {
    hostname: osHostname(),
    inventory,
  })) as Hello;
  input.log(`joined as ${hello.name} (${hello.runnerId})`);
  const token = hello.runnerToken;

  async function heartbeat() {
    await json(url, token, "/api/runners/heartbeat", { inventory: await detectAgents() });
  }

  await heartbeat();
  const beat = setInterval(() => void heartbeat().catch((error: unknown) => {
    input.log(`heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
  }), 15_000);

  let stopping = false;
  const shutdown = () => {
    stopping = true;
    clearInterval(beat);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    try {
      const claimed = (await json(url, token, "/api/runners/claim", {})) as { job: AgentJob | null };
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
      input.log(`claim failed: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
