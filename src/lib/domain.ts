/** Types shared by the server and the pages. No runtime dependencies. */

import type { Finding } from "./review.ts";

export const CONNECTION_STATUS = ["connected", "needs_reauth", "error", "paused"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Connection settings cross the wire and land in a JSON column, so they stay JSON. */
export type ConnectionSettings = Record<string, JsonValue>;

/**
 * How far a run got. A loop runs by itself, so these are all outcomes rather
 * than requests for attention.
 */
export const TASK_STATE = [
  "queued",
  "preparing",
  "applying",
  /** Output ready, nothing written: a dry run, and later a loop that asks to be checked. */
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

/**
 * The sort of thing a loop acts on. Widened by whichever connector needs it:
 * the list is closed so that the few places which phrase a kind for a person
 * have to say something for every one of them.
 */
export type WorkItemKind = "pull_request" | "issue" | "message" | "email" | "occurrence";

export type TaskView = {
  id: string;
  loopId: string;
  loopName: string;
  connectorId: string;
  state: TaskState;
  sourceUrl: string;
  sourceKind: WorkItemKind;
  sourceRef: string;
  /** Only known once the connector has fetched it. */
  sourceTitle: string | null;
  dryRun: boolean;
  agentId: string | null;
  agentCommand: string | null;
  output: string | null;
  /** Findings that will be attached to lines, rather than to the review body. */
  comments: Finding[];
  /** Which connector writes the answer, which need not be the one that read it. */
  actionConnectorId: string;
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

/** A loop as the browser sees it: a workflow plus the answers it asked for. */
export type LoopView = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  connectorId: string;
  workflowId: string;
  /** Keys are declared by the workflow in the connector manifest. */
  settings: ConnectionSettings;
  /** What the agent is asked. Starts out the workflow's words and is then the loop's. */
  prompt: string;
  /** Added after the prompt, for a note not worth editing it over. Usually null. */
  guidance: string | null;
  /** Null means whichever agent is the default when the loop runs. */
  agentId: string | null;
  /** Where the answer goes. Starts out the workflow's own and is then the loop's. */
  actionConnectorId: string;
  actionId: string;
  /** Keys are declared by the action, not by the workflow. Empty is the norm. */
  actionTarget: ConnectionSettings;
  /** How long to leave between looks. Null is every time the engine looks. */
  pollEveryMs: number | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Everything about a loop that a person chose, and nothing the database
 * decided. What a form collects and what saving one takes.
 */
export type LoopDraft = {
  name: string;
  connectorId: string;
  workflowId: string;
  prompt: string;
  guidance: string | null;
  agentId: string | null;
  settings: ConnectionSettings;
  actionConnectorId: string;
  actionId: string;
  actionTarget: ConnectionSettings;
  pollEveryMs: number | null;
  enabled: boolean;
};

/**
 * A loop being edited, which may not exist yet.
 *
 * The null id is the whole difference between shaping a new loop and changing
 * a saved one, and it is deliberately the only difference: a loop that has
 * been chosen but not saved is not a row that needs cleaning up later, and
 * nothing polls it or runs it in the meantime.
 */
export type LoopEdit = LoopDraft & { id: string | null };

/** Something a loop noticed and did not act on, and the reason it did not. */
export type BacklogItem = {
  key: string;
  sourceKind: WorkItemKind;
  sourceRef: string;
  sourceTitle: string;
  sourceUrl: string;
  /** Why it was held back, or null when it was simply there before the loop. */
  hold: string | null;
  seenAt: string;
};

/** Whether a loop is really watching, which is the thing a page cannot infer. */
export type LoopPollState = {
  polledAt: string | null;
  pollError: string | null;
  backlog: BacklogItem[];
};

/** What a loop needs to run, resolved when the page loads rather than stored. */
export type LoopReadiness = {
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
