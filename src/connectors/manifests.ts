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
  TriggerDescriptor,
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

export function connectorTrigger(
  connectorId: ConnectorId,
  triggerId: string,
): TriggerDescriptor | undefined {
  return connectorManifest(connectorId)?.triggers.find((entry) => entry.id === triggerId);
}

/** A trigger with nothing on top: what a custom loop runs. */
function customOn(trigger: TriggerDescriptor): WorkflowDescriptor {
  return {
    ...trigger,
    triggerId: trigger.id,
    name: trigger.when,
    summary: `When ${trigger.trigger}.`,
    prompt: "",
    custom: true,
  };
}

/**
 * What a loop runs, by the id it stores: a workflow, merged with the trigger
 * it sits on, or a trigger alone for a custom loop.
 */
export function connectorWorkflow(
  connectorId: ConnectorId,
  workflowId: string,
): WorkflowDescriptor | undefined {
  const manifest = connectorManifest(connectorId);
  if (!manifest) return undefined;
  const defined = manifest.workflows.find((entry) => entry.id === workflowId);
  if (defined) {
    const trigger = manifest.triggers.find((entry) => entry.id === defined.triggerId);
    if (!trigger) return undefined;
    return {
      ...trigger,
      ...defined,
      actionId: defined.actionId ?? trigger.actionId,
      actionConnectorId: defined.actionConnectorId ?? trigger.actionConnectorId,
      actionTarget: defined.actionTarget ?? trigger.actionTarget,
      pollEveryMs: defined.pollEveryMs ?? trigger.pollEveryMs,
      triggerId: trigger.id,
      custom: false,
    };
  }
  const trigger = manifest.triggers.find((entry) => entry.id === workflowId);
  return trigger ? customOn(trigger) : undefined;
}

export function connectorAction(
  connectorId: ConnectorId,
  actionId: string,
): ActionDescriptor | undefined {
  return connectorManifest(connectorId)?.actions.find((entry) => entry.id === actionId);
}

/**
 * Keeping the answer in Inbox is the clock's action, because the clock is the
 * one connector with nowhere of its own to write. To a person it is not a
 * Schedule thing at all, so it is named for where the answer stays.
 */
const INBOX_ONLY = { connectorId: "schedule", actionId: "schedule.record" } as const;

export function isInboxOnly(connectorId: string, actionId: string): boolean {
  return connectorId === INBOX_ONLY.connectorId && actionId === INBOX_ONLY.actionId;
}

/** What to call a connector as a place answers go. */
export function writerName(connectorId: ConnectorId): string {
  if (connectorId === INBOX_ONLY.connectorId) return "Inbox";
  return connectorManifest(connectorId)?.name ?? connectorId;
}

/** Where a loop's answer goes, in a few words: "GitHub · Submit a review", or "Inbox only". */
export function destinationLabel(connectorId: ConnectorId, actionId: string): string {
  if (isInboxOnly(connectorId, actionId)) return "Inbox only";
  const action = connectorAction(connectorId, actionId);
  return action ? `${writerName(connectorId)} · ${action.name}` : "No destination";
}

/** Connectors that can write, Inbox first, for the question of where an answer goes. */
export function writers(): ConnectorManifest[] {
  const all = CONNECTOR_MANIFESTS.filter((entry) => entry.actions.length > 0);
  return [
    ...all.filter((entry) => entry.id === INBOX_ONLY.connectorId),
    ...all.filter((entry) => entry.id !== INBOX_ONLY.connectorId),
  ];
}

/**
 * Every workflow on offer, for the page that asks which one to turn on.
 *
 * The clock leads: it needs no account, and a scheduled job is the easiest
 * first loop to try. The rest follow the connectors' own order.
 */
export function allWorkflows(): Array<{
  connector: ConnectorManifest;
  workflow: WorkflowDescriptor;
}> {
  const ordered = [
    ...CONNECTOR_MANIFESTS.filter((connector) => connector.id === "schedule"),
    ...CONNECTOR_MANIFESTS.filter((connector) => connector.id !== "schedule"),
  ];
  return ordered.flatMap((connector) =>
    connector.workflows.map((entry) => ({
      connector,
      workflow: connectorWorkflow(connector.id, entry.id)!,
    })),
  );
}

/** Every trigger on offer, the clock first, for choosing what starts a custom loop. */
export function allTriggers(): Array<{ connector: ConnectorManifest; trigger: TriggerDescriptor }> {
  const ordered = [
    ...CONNECTOR_MANIFESTS.filter((connector) => connector.id === "schedule"),
    ...CONNECTOR_MANIFESTS.filter((connector) => connector.id !== "schedule"),
  ];
  return ordered.flatMap((connector) =>
    connector.triggers.map((trigger) => ({ connector, trigger })),
  );
}
