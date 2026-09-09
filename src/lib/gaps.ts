import { connectorManifest } from "@/connectors/manifests.ts";
import type { LoopReadiness, LoopView } from "@/lib/domain.ts";

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
  if (readiness.installedAgentIds.length === 0) {
    missing.push("No coding agent was found on this machine, so nothing can be prepared.");
  } else if (!readiness.defaultAgentId) {
    missing.push("No default agent is chosen, so loops that do not name one cannot run.");
  }

  // Two services to be connected to now, since a loop can answer somewhere it
  // does not watch. Skipped entirely when nothing is connected, because
  // saying so once is enough.
  if (connected.size > 0) {
    const name = (id: string) => connectorManifest(id)?.name ?? id;
    for (const loop of loops) {
      if (!connected.has(loop.connectorId)) {
        missing.push(`${loop.name} watches ${name(loop.connectorId)}, which has no account.`);
      }
      if (!connected.has(loop.actionConnectorId)) {
        missing.push(
          `${loop.name} answers on ${name(loop.actionConnectorId)}, which has no account.`,
        );
      }
    }
  }
  return missing;
}
