import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { PermissionMode } from "#/agents/types.ts";
import type {
  ConnectionSettings,
  ConnectionStatus,
  JsonValue,
  TaskSourceKind,
  TaskState,
} from "#/lib/domain.ts";

/**
 * One row per connected account, so a connector can be connected several times
 * (two GitHub accounts, or github.com alongside an Enterprise host). Credentials
 * live in the keychain under the row id, never in this table.
 */
export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id").notNull(),
    status: text("status").$type<ConnectionStatus>().notNull().default("connected"),
    accountId: text("account_id").notNull(),
    accountLabel: text("account_label").notNull(),
    accountUrl: text("account_url"),
    avatarUrl: text("avatar_url"),
    scopes: text("scopes"),
    settings: text("settings", { mode: "json" }).$type<ConnectionSettings>().notNull().default({}),
    cursor: text("cursor", { mode: "json" }).$type<Record<string, JsonValue> | null>(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("connections_account_unique").on(table.connectorId, table.accountId),
    index("connections_connector_idx").on(table.connectorId),
  ],
);

/**
 * Short-lived state for an authorization that is mid-flight: the CSRF state and
 * the PKCE verifier that the callback must present. Rows are consumed on
 * callback and swept after they expire.
 */
export const authAttempts = sqliteTable("auth_attempts", {
  state: text("state").primaryKey(),
  connectorId: text("connector_id").notNull(),
  verifier: text("verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  returnTo: text("return_to"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * One run of one rule against one thing. Kept whether it wrote anything or
 * not, because a rule that runs on its own is only trustworthy if you can see
 * afterwards what it did.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    connectorId: text("connector_id").notNull(),
    state: text("state").$type<TaskState>().notNull().default("queued"),
    /** What the task is about, resolved once so the record survives the source. */
    sourceUrl: text("source_url").notNull(),
    sourceKind: text("source_kind").$type<TaskSourceKind>().notNull(),
    sourceRepo: text("source_repo").notNull(),
    sourceNumber: integer("source_number").notNull(),
    /**
     * Identifying a link needs no network, but the title does, so it arrives
     * when the worker fetches rather than when the task is queued.
     */
    sourceTitle: text("source_title"),
    /** Set when a run was asked to stop before writing anything. */
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
    agentId: text("agent_id"),
    agentCommand: text("agent_command"),
    /** What the agent produced, which is also what gets written back. */
    output: text("output"),
    actionId: text("action_id").notNull(),
    /** Where the write landed, once it has. */
    resultUrl: text("result_url"),
    error: text("error"),
    /** Everything the agent printed, streamed to disk while it runs. */
    logPath: text("log_path"),

    // Queue bookkeeping. The work happens in another process, so a task has to
    // carry enough state for the worker to be interrupted at any moment.
    attempts: integer("attempts").notNull().default(0),
    /** Not claimable before this: how a retry backs off. */
    runAfter: integer("run_after", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /**
     * A claim that expires. Whoever holds it renews it while working, so a
     * task whose worker died can be told apart from one still being worked on.
     */
    leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    /**
     * Set when the task came from a signal rather than from a pasted link.
     * The signals table already prevents a rule acting twice; this is the
     * second lock, held by the database, in case two polls overlap.
     */
    dedupeKey: text("dedupe_key"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("tasks_rule_idx").on(table.ruleId),
    index("tasks_created_idx").on(table.createdAt),
    /** The worker's only question: what can I claim right now? */
    index("tasks_claim_idx").on(table.state, table.runAfter),
    uniqueIndex("tasks_dedupe_idx").on(table.dedupeKey),
  ],
);

/**
 * One instance of one of a connector's workflows. The workflow decides what to
 * watch for, what to ask, and where to write; a rule only carries the answers
 * to the few questions the workflow asks. Settings are a JSON blob because
 * only the connector knows what can be narrowed.
 */
export const rules = sqliteTable(
  "rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Lowest first. The first matching rule wins, so order is meaningful. */
    priority: integer("priority").notNull(),
    connectorId: text("connector_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    settings: text("settings", { mode: "json" })
      .$type<ConnectionSettings>()
      .notNull()
      .default({}),
    /** Added to the workflow's own prompt. Most rules leave it empty. */
    guidance: text("guidance"),
    /** Null means whichever agent is currently the default. */
    agentId: text("agent_id"),
    /**
     * Null until the rule has been looked at once. That first look is what
     * separates the backlog that predates the rule from everything after it,
     * so it is worth being able to tell the two apart.
     */
    polledAt: integer("polled_at", { mode: "timestamp_ms" }),
    /** Why the last look failed, if it did. Cleared by a look that works. */
    pollError: text("poll_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("rules_priority_idx").on(table.priority)],
);

/**
 * What a rule has already noticed. A rule acts once per key and never again,
 * which is the whole of not reviewing the same commit twice.
 */
export const SIGNAL_OUTCOME = [
  /** A task was made for it. */
  "queued",
  /** It was already waiting when the rule was created, so it was left alone. */
  "backlog",
  /** A rule that comes first took it. */
  "superseded",
] as const;
export type SignalOutcome = (typeof SIGNAL_OUTCOME)[number];

export const signals = sqliteTable(
  "signals",
  {
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    /** The connector's own idea of identity: changing it means act again. */
    key: text("key").notNull(),
    outcome: text("outcome").$type<SignalOutcome>().notNull(),
    /** Enough to show and to act on later, without asking the service again. */
    sourceKind: text("source_kind").$type<TaskSourceKind>().notNull(),
    sourceRepo: text("source_repo").notNull(),
    sourceNumber: integer("source_number").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourceUrl: text("source_url").notNull(),
    taskId: text("task_id"),
    seenAt: integer("seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.ruleId, table.key] }),
    /** The backlog question: what is this rule holding and has never run? */
    index("signals_outcome_idx").on(table.ruleId, table.outcome),
  ],
);

/**
 * Agents are discovered on the machine every time, so nothing about their
 * presence is stored. Only the choices a person makes live here.
 */
export const agentSettings = sqliteTable("agent_settings", {
  agentId: text("agent_id").primaryKey(),
  permissionMode: text("permission_mode").$type<PermissionMode>().notNull(),
  model: text("model"),
  timeoutMs: integer("timeout_ms").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** Small key/value store for single settings such as the default agent. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<JsonValue>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Task = typeof tasks.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type AuthAttempt = typeof authAttempts.$inferSelect;
