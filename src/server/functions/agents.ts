import { createServerFn } from "@tanstack/react-start";
import type { PermissionMode } from "#/agents/types.ts";
import type { AgentOnRunner, AgentView } from "#/lib/domain.ts";
import { listAgents, saveAgentSettings, setDefaultAgent, testAgent } from "../agents.ts";
import { availableAgentIds, listRunners } from "../runners.ts";

async function withRunners(agents: AgentView[]): Promise<AgentView[]> {
  const runners = await listRunners();
  const available = await availableAgentIds();
  const stored = agents.find((agent) => agent.isDefault)?.agentId ?? null;
  const implicit = !stored && available.length === 1 ? available[0]! : null;
  return agents.map((agent) => {
    const onRunners: AgentOnRunner[] = runners.flatMap((runner) => {
      const entry = runner.inventory.find((item) => item.agentId === agent.agentId);
      if (!entry?.installed) return [];
      return [
        {
          runnerId: runner.id,
          name: runner.name,
          status: runner.status,
          signedIn: entry.signedIn,
          version: entry.version,
        },
      ];
    });
    const isDefault = agent.agentId === stored || agent.agentId === implicit;
    return {
      ...agent,
      onRunners,
      isDefault,
      defaultIsImplicit: isDefault && agent.agentId === implicit,
    };
  });
}

export const getAgentsPage = createServerFn({ method: "GET" }).handler(async () => ({
  agents: await withRunners(await listAgents()),
}));

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
    await saveAgentSettings(data.agentId, {
      permissionMode: data.permissionMode,
      model: data.model,
      timeoutMs: data.timeoutMs,
    });
    return await withRunners(await listAgents());
  });

export const chooseDefaultAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { agentId: string }) => data)
  .handler(async ({ data }) => {
    await setDefaultAgent(data.agentId);
    return await withRunners(await listAgents());
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
