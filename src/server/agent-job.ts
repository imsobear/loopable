import { isAbsolute, join } from "node:path";
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
 * Stands in a prompt for the runner's own workspace, which the dispatcher
 * cannot know. The runner replaces it before the agent sees the prompt.
 */
export const WORKSPACE = "{{loopable:workspace}}";

/**
 * A loop's folder is relative to the home folder, because each runner keeps
 * its checkouts under its own home. "~/code/web" and "code/web" are the same.
 * An absolute path is from before that, and only means something on the host
 * it was written on.
 */
export function normalizeFolder(folder: string): string {
  const trimmed = folder.trim();
  if (trimmed === "~") return "";
  return trimmed.startsWith("~/") ? trimmed.slice(2) : trimmed;
}

export function folderIsLegacy(folder: string): boolean {
  return isAbsolute(folder.trim());
}

/** Where a loop's folder is on the machine this runs on. */
export function resolveFolder(folder: string, home: string): string {
  const normal = normalizeFolder(folder);
  return isAbsolute(normal) ? normal : join(home, normal);
}

/**
 * Only an old absolute folder ties a job to Loopable's host. A relative one
 * goes to any runner, which looks for it under its own home.
 */
export function jobRequiresHost(job: Pick<AgentJob, "cwd">): boolean {
  return Boolean(job.cwd && folderIsLegacy(job.cwd));
}

export function filesFromWorkItem(item: { context: AgentJobFile[] }): AgentJobFile[] {
  return item.context.map((file) => ({ name: file.name, body: file.body }));
}
