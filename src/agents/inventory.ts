import { AGENT_MANIFESTS } from "./manifests.ts";
import { agentRuntime } from "./runtimes.ts";
import type { RunnerInventoryEntry } from "#/lib/domain.ts";

/** What is installed and signed in on this host. No database. */
export async function detectAgents(): Promise<RunnerInventoryEntry[]> {
  return Promise.all(
    AGENT_MANIFESTS.map(async (manifest) => {
      const runtime = agentRuntime(manifest.id);
      const detection = await runtime.detect();
      const auth = detection.installed ? await runtime.authStatus() : null;
      return {
        agentId: manifest.id,
        installed: detection.installed,
        version: detection.installed ? detection.version : null,
        signedIn: Boolean(auth?.signedIn),
        detail: auth?.detail ?? "",
      };
    }),
  );
}
