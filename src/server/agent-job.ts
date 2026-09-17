import type { AgentSettingsValues } from "#/agents/types.ts";

export type AgentJobFile = { name: string; body: string };

export type AgentJob = {
  taskId: string;
  agentId: string;
  prompt: string;
  settings: AgentSettingsValues;
  files: AgentJobFile[];
  /**
   * A directory that already exists on this host. Folder jobs set this so the
   * agent can read a checkout only this machine has. Absent otherwise: the
   * runner works in a throwaway directory that holds the files.
   */
  cwd?: string;
};

export type AgentJobResult = {
  ok: boolean;
  output: string;
  detail?: string;
  aborted?: boolean;
  durationMs: number;
  command: string;
};

/** The agent says this when the honest answer is silence. */
export const AGENT_NOTHING = "NOTHING_TO_DO";

export function isAgentNothing(text: string): boolean {
  const compact = (value: string) => value.replace(/[`*_.\s]/g, "").toUpperCase();
  return compact(text) === compact(AGENT_NOTHING);
}

/**
 * Folder jobs name a path that only exists on Loopable's host.
 * A runner on another hostname cannot see that folder.
 */
export function jobRequiresHost(job: Pick<AgentJob, "cwd">): boolean {
  return Boolean(job.cwd);
}

export function filesFromWorkItem(item: { context: AgentJobFile[] }): AgentJobFile[] {
  return item.context.map((file) => ({ name: file.name, body: file.body }));
}
