import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ConnectionSettings, ConnectionStatus, JsonValue } from "@/lib/domain.ts";

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

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type AuthAttempt = typeof authAttempts.$inferSelect;
