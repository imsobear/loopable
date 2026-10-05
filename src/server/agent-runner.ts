import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentRuntime } from "#/agents/runtimes.ts";
import type { AgentRunResult } from "#/agents/types.ts";
import { WORKSPACE, resolveFolder, type AgentJob, type AgentJobResult } from "./agent-job.ts";
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
  let cwd = workspace;
  if (job.cwd) {
    cwd = resolveFolder(job.cwd, homedir());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return {
        ok: false,
        output: "",
        detail: `There is no folder at ${cwd} on this runner.`,
        durationMs: 0,
        command: "",
      };
    }
  }
  const run = options.run ?? ((input) => agentRuntime(job.agentId).run(input));
  const result = await run({
    // Context files sit in this runner's workspace, which only it knows.
    prompt: job.prompt.replaceAll(WORKSPACE, workspace),
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
