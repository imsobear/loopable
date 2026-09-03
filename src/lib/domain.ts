/** Types shared by the server and the pages. No runtime dependencies. */

export const CONNECTION_STATUS = ["connected", "needs_reauth", "error", "paused"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Connection settings cross the wire and land in a JSON column, so they stay JSON. */
export type ConnectionSettings = Record<string, JsonValue>;

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
