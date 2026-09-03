import { createServerFn } from "@tanstack/react-start";
import type { PermissionMode } from "#/agents/types.ts";
import type { AgentView } from "#/lib/domain.ts";
import { listAgents, saveAgentSettings, setDefaultAgent, testAgent } from "../agents.ts";

export const getAgents = createServerFn({ method: "GET" }).handler(
  (): Promise<AgentView[]> => listAgents(),
);

export const saveAgent = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      agentId: string;
      permissionMode: PermissionMode;
      model: string | null;
      timeoutMs: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    saveAgentSettings(data.agentId, {
      permissionMode: data.permissionMode,
      model: data.model,
      timeoutMs: data.timeoutMs,
    });
    return listAgents();
  });

export const chooseDefaultAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { agentId: string }) => data)
  .handler(async ({ data }) => {
    setDefaultAgent(data.agentId);
    return listAgents();
  });

export const runAgentTest = createServerFn({ method: "POST" })
  .inputValidator((data: { agentId: string }) => data)
  .handler(async ({ data }) => {
    const result = await testAgent(data.agentId);
    return {
      passed: result.passed,
      output: result.output.slice(0, 2000),
      detail: result.detail ?? null,
      durationMs: result.durationMs,
      command: result.command,
    };
  });
