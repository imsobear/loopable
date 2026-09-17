import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentRuntime } from "#/agents/runtimes.ts";
import type { AgentRunResult } from "#/agents/types.ts";
import type { AgentJob, AgentJobResult } from "./agent-job.ts";
import { runDir } from "./paths.ts";

export type RunAgentJobOptions = {
  /** Tests swap this so a pass does not spend money. */
  run?: (input: {
    prompt: string;
    cwd: string;
    settings: AgentJob["settings"];
    outputFile: string;
    logFile: string;
    signal?: AbortSignal;
  }) => Promise<AgentRunResult>;
  signal?: AbortSignal;
  /** Joined runners work in a throwaway directory; the host uses the run dir. */
  workspace?: string;
};

/**
 * Runs one agent job. Writes the context files, then invokes the agent.
 * The job is already the whole instruction: this does not branch on workflow.
 */
export async function runAgentJob(
  job: AgentJob,
  options: RunAgentJobOptions = {},
): Promise<AgentJobResult> {
  const workspace = options.workspace ?? runDir(job.taskId);
  mkdirSync(workspace, { recursive: true });
  for (const file of job.files) {
    writeFileSync(join(workspace, file.name), file.body);
  }
  const logFile = join(workspace, "agent.log");
  const outputFile = join(workspace, "answer.txt");
  const cwd = job.cwd ?? workspace;
  const run = options.run ?? ((input) => agentRuntime(job.agentId).run(input));
  const result = await run({
    prompt: job.prompt,
    cwd,
    settings: job.settings,
    outputFile,
    logFile,
    signal: options.signal,
  });
  return {
    ok: result.ok,
    output: result.output,
    detail: result.detail,
    aborted: result.aborted,
    durationMs: result.durationMs,
    command: result.command,
  };
}
