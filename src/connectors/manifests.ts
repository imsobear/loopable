import { githubManifest } from "./github/manifest.ts";
import { wechatManifest } from "./wechat/manifest.ts";
import type { ConnectorId, ConnectorManifest, WorkflowDescriptor } from "./types.ts";

/**
 * Client-safe registry. Imports are explicit rather than a glob so the bundler
 * can see exactly what ships and so a typo fails the build.
 */
export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [githubManifest, wechatManifest];

export function connectorManifest(id: ConnectorId): ConnectorManifest | undefined {
  return CONNECTOR_MANIFESTS.find((manifest) => manifest.id === id);
}

export function connectorWorkflow(
  connectorId: ConnectorId,
  workflowId: string,
): WorkflowDescriptor | undefined {
  return connectorManifest(connectorId)?.workflows.find((entry) => entry.id === workflowId);
}

/** Every workflow on offer, for the page that asks which one to turn on. */
export function allWorkflows(): Array<{
  connector: ConnectorManifest;
  workflow: WorkflowDescriptor;
}> {
  return CONNECTOR_MANIFESTS.flatMap((connector) =>
    connector.workflows.map((workflow) => ({ connector, workflow })),
  );
}
