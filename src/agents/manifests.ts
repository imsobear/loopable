import { codexManifest } from "./codex/manifest.ts";
import { cursorAgentManifest } from "./cursor-agent/manifest.ts";
import type { AgentId, AgentManifest } from "./types.ts";

/** Client-safe registry, listing only agents whose invocation we have verified. */
export const AGENT_MANIFESTS: AgentManifest[] = [codexManifest, cursorAgentManifest];

export function agentManifest(id: AgentId): AgentManifest | undefined {
  return AGENT_MANIFESTS.find((manifest) => manifest.id === id);
}
