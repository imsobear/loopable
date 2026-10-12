import { claudeManifest } from "./claude/manifest.ts";
import { codexManifest } from "./codex/manifest.ts";
import { cursorAgentManifest } from "./cursor-agent/manifest.ts";
import type { AgentId, AgentManifest } from "./types.ts";

/** Client-safe registry, listing only agents whose invocation we have verified. */
export const AGENT_MANIFESTS: AgentManifest[] = [codexManifest, claudeManifest, cursorAgentManifest];

export function agentManifest(id: AgentId): AgentManifest | undefined {
  return AGENT_MANIFESTS.find((manifest) => manifest.id === id);
}

/**
 * Which agent runs a loop that does not name one: the one chosen as default,
 * when a runner has it, or else the first of the catalog that a runner has. A
 * runner with three agents signed in and no choice made yet should still run
 * things, rather than refuse until someone picks.
 */
export function fallbackAgent(chosen: string | null, available: string[]): string | null {
  if (chosen && available.includes(chosen)) return chosen;
  return AGENT_MANIFESTS.find((manifest) => available.includes(manifest.id))?.id ?? null;
}
