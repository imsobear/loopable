import { agentManifest } from "@/agents/manifests.ts";
import { connectorManifest, connectorWorkflow, needsAccount } from "@/connectors/manifests.ts";
import type { LoopReadiness, LoopView } from "@/lib/domain.ts";

function agentName(id: string): string {
  return agentManifest(id)?.name ?? id;
}

function wantedAgent(loop: LoopView, readiness: LoopReadiness): string | null {
  return loop.agentId ?? readiness.defaultAgentId;
}

function needsHost(loop: LoopView): boolean {
  const runsIn = connectorWorkflow(loop.connectorId, loop.workflowId)?.runsIn;
  return runsIn === "folder";
}

/**
 * Why this loop cannot run right now. Empty when it can, or when it is off.
 */
export function issuesFor(readiness: LoopReadiness, loop: LoopView): string[] {
  if (!loop.enabled) return [];
  const issues: string[] = [];
  const agentId = wantedAgent(loop, readiness);
  const pool = needsHost(loop) ? readiness.hostAgentIds : readiness.availableAgentIds;
  if (!agentId) {
    issues.push(
      loop.agentId
        ? `${loop.name} uses ${agentName(loop.agentId)}, which no online runner has signed in.`
        : "No default agent is chosen, so this loop cannot run.",
    );
  } else if (!pool.includes(agentId)) {
    issues.push(
      needsHost(loop)
        ? `${loop.name} needs a runner on this host with ${agentName(agentId)} signed in.`
        : `${loop.name} uses ${agentName(agentId)}, which no online runner has signed in.`,
    );
  }
  return issues;
}

/**
 * What stands between the loops someone has written and any of them running.
 *
 * Kept apart from the page that shows it because the interesting part is which
 * things count as a gap and how they are worded, and neither is worth
 * rendering a component to check.
 */
export function gapsFor(readiness: LoopReadiness, loops: LoopView[]): string[] {
  const missing: string[] = [];
  const connected = new Set(readiness.connectedConnectorIds);
  if (connected.size === 0) {
    missing.push("No account is connected yet, so no signal can arrive.");
  }
  if (readiness.availableAgentIds.length === 0) {
    missing.push("No coding agent is signed in on any runner, so nothing can be prepared.");
  } else if (!readiness.defaultAgentId) {
    missing.push("No default agent is chosen, so loops that do not name one cannot run.");
  }

  if (connected.size > 0) {
    const name = (id: string) => connectorManifest(id)?.name ?? id;
    for (const loop of loops) {
      if (!loop.enabled) continue;
      if (needsAccount(loop.connectorId) && !connected.has(loop.connectorId)) {
        missing.push(`${loop.name} watches ${name(loop.connectorId)}, which has no account.`);
      }
      if (needsAccount(loop.actionConnectorId) && !connected.has(loop.actionConnectorId)) {
        missing.push(
          `${loop.name} answers on ${name(loop.actionConnectorId)}, which has no account.`,
        );
      }
    }
  }

  if (readiness.availableAgentIds.length > 0) {
    for (const loop of loops) {
      for (const issue of issuesFor(readiness, loop)) {
        if (issue === "No default agent is chosen, so this loop cannot run.") continue;
        missing.push(issue);
      }
    }
  }
  return missing;
}
