/** Types shared by the server and the pages. No runtime dependencies. */

import type { Finding } from "./review.ts";

export const CONNECTION_STATUS = ["connected", "needs_reauth", "error", "paused"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Connection settings cross the wire and land in a JSON column, so they stay JSON. */
export type ConnectionSettings = Record<string, JsonValue>;

/**
 * How far a run got. A rule runs by itself, so these are all outcomes rather
 * than requests for attention.
 */
export const TASK_STATE = [
  "queued",
  "preparing",
  "applying",
  /** Output ready, nothing written: a dry run, and later a rule that asks to be checked. */
  "prepared",
  "done",
  /** The agent judged there was nothing worth writing. */
  "skipped",
  "failed",
  "cancelled",
] as const;
export type TaskState = (typeof TASK_STATE)[number];

/**
 * States the worker still owes something for. Used by the pages to know when
 * to keep looking, and by the reaper to find runs a dead process abandoned.
 */
export const TASK_ACTIVE_STATES = ["queued", "preparing", "applying"] as const satisfies TaskState[];

export function isTaskActive(state: TaskState): boolean {
  return (TASK_ACTIVE_STATES as readonly TaskState[]).includes(state);
}

export type TaskSourceKind = "pull_request" | "issue";

export type TaskView = {
  id: string;
  ruleId: string;
  ruleName: string;
  connectorId: string;
  state: TaskState;
  sourceUrl: string;
  sourceKind: TaskSourceKind;
  sourceRepo: string;
  sourceNumber: number;
  /** Only known once the connector has fetched it. */
  sourceTitle: string | null;
  dryRun: boolean;
  agentId: string | null;
  agentCommand: string | null;
  output: string | null;
  /** Findings that will be attached to lines, rather than to the review body. */
  comments: Finding[];
  actionId: string;
  resultUrl: string | null;
  error: string | null;
  attempts: number;
  cancelRequested: boolean;
  durationMs: number | null;
  createdAt: string;
  /** When the worker picked it up, so the pages can count the minutes. */
  startedAt: string | null;
  updatedAt: string;
};

/** A rule as the browser sees it: a workflow plus the answers it asked for. */
export type RuleView = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  connectorId: string;
  workflowId: string;
  /** Keys are declared by the workflow in the connector manifest. */
  settings: ConnectionSettings;
  /** Added to the workflow's own prompt. Usually null. */
  guidance: string | null;
  /** Null means whichever agent is the default when the rule runs. */
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Something that was already waiting when a rule was created. */
export type BacklogItem = {
  key: string;
  sourceKind: TaskSourceKind;
  sourceRepo: string;
  sourceNumber: number;
  sourceTitle: string;
  sourceUrl: string;
  seenAt: string;
};

/** Whether a rule is really watching, which is the thing a page cannot infer. */
export type RulePollState = {
  polledAt: string | null;
  pollError: string | null;
  backlog: BacklogItem[];
};

/** What a rule needs to run, resolved when the page loads rather than stored. */
export type RuleReadiness = {
  connectedConnectorIds: string[];
  defaultAgentId: string | null;
  installedAgentIds: string[];
};

/** An agent as the browser sees it: what was found on the machine plus choices. */
export type AgentView = {
  agentId: string;
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  auth: { signedIn: boolean; detail: string } | null;
  settings: { permissionMode: "read_only" | "workspace_write"; model: string | null; timeoutMs: number };
  isDefault: boolean;
  /** True when nothing was chosen and this is simply the only agent installed. */
  defaultIsImplicit: boolean;
  commandPreview: string;
};

/** A connection as the browser sees it: no credentials, no Date objects. */
export type ConnectionView = {
  id: string;
  connectorId: string;
  status: ConnectionStatus;
  accountLabel: string;
  accountUrl: string | null;
  avatarUrl: string | null;
  scopes: string[];
  settings: ConnectionSettings;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};
