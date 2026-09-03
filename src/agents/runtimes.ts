import { codexRuntime } from "./codex/runtime.ts";
import { cursorAgentRuntime } from "./cursor-agent/runtime.ts";
import type { AgentId, AgentRuntime } from "./types.ts";

/** Server-only registry. Never import this from a component. */
const RUNTIMES: Record<AgentId, AgentRuntime> = {
  codex: codexRuntime,
  "cursor-agent": cursorAgentRuntime,
};

export function agentRuntime(id: AgentId): AgentRuntime {
  const runtime = RUNTIMES[id];
  if (!runtime) throw new Error(`Unknown agent: ${id}`);
  return runtime;
}
