import { githubManifest } from "./github/manifest.ts";
import { gmailManifest } from "./gmail/manifest.ts";
import { scheduleManifest } from "./schedule/manifest.ts";
import { slackManifest } from "./slack/manifest.ts";
import { feishuManifest } from "./feishu/manifest.ts";
import { wechatManifest } from "./wechat/manifest.ts";
import type {
  ActionDescriptor,
  ConnectorId,
  ConnectorManifest,
  WorkflowDescriptor,
} from "./types.ts";

/**
 * Client-safe registry. Imports are explicit rather than a glob so the bundler
 * can see exactly what ships and so a typo fails the build.
 */
export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  githubManifest,
  slackManifest,
  feishuManifest,
  gmailManifest,
  wechatManifest,
  scheduleManifest,
];

export function connectorManifest(id: ConnectorId): ConnectorManifest | undefined {
  return CONNECTOR_MANIFESTS.find((manifest) => manifest.id === id);
}

/**
 * Whether this connector is somewhere you have a Connection.
 *
 * Asked in three places that would otherwise each assume every connector is:
 * the page listing connections, the check for what stands between a loop and
 * running, and the fetch of a credential for a run.
 */
export function needsAccount(id: ConnectorId): boolean {
  return connectorManifest(id)?.auth.kind !== "none";
}

/**
 * What one Connection of this connector is called in the UI.
 * A Slack or Feishu bot is a pasted app credential, not a login.
 */
export function connectionNoun(id: ConnectorId): "account" | "bot" {
  return connectorManifest(id)?.auth.kind === "token" ? "bot" : "account";
}

export function connectorWorkflow(
  connectorId: ConnectorId,
  workflowId: string,
): WorkflowDescriptor | undefined {
  return connectorManifest(connectorId)?.workflows.find((entry) => entry.id === workflowId);
}

export function connectorAction(
  connectorId: ConnectorId,
  actionId: string,
): ActionDescriptor | undefined {
  return connectorManifest(connectorId)?.actions.find((entry) => entry.id === actionId);
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
