import { randomUUID } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import type { AuthResult, ConnectorAccount, ConnectorId } from "@/connectors/types.ts";
import { connectorRuntime } from "@/connectors/runtimes.ts";
import { db } from "./db/client.ts";
import { authAttempts, connections, type Connection } from "./db/schema.ts";
import { deleteCredential, readCredential, writeCredential } from "./secrets.ts";
import type { ConnectionSettings, ConnectionView } from "@/lib/domain.ts";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

function toView(row: Connection): ConnectionView {
  return {
    id: row.id,
    connectorId: row.connectorId,
    status: row.status,
    accountLabel: row.accountLabel,
    accountUrl: row.accountUrl,
    avatarUrl: row.avatarUrl,
    scopes: row.scopes ? row.scopes.split(",").filter(Boolean) : [],
    settings: row.settings,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export function listConnections(): ConnectionView[] {
  return db()
    .select()
    .from(connections)
    .orderBy(asc(connections.createdAt))
    .all()
    .map(toView);
}

export function getConnection(id: string): Connection | undefined {
  return db().select().from(connections).where(eq(connections.id, id)).get();
}

export function startAuthAttempt(input: {
  connectorId: ConnectorId;
  state: string;
  verifier: string;
  redirectUri: string;
  returnTo?: string;
}): void {
  const now = Date.now();
  db().delete(authAttempts).where(lt(authAttempts.expiresAt, new Date(now))).run();
  db()
    .insert(authAttempts)
    .values({
      state: input.state,
      connectorId: input.connectorId,
      verifier: input.verifier,
      redirectUri: input.redirectUri,
      returnTo: input.returnTo,
      expiresAt: new Date(now + ATTEMPT_TTL_MS),
    })
    .run();
}

/** Consumes the attempt: a state value is only ever valid once. */
export function takeAuthAttempt(state: string) {
  const attempt = db().select().from(authAttempts).where(eq(authAttempts.state, state)).get();
  if (attempt) db().delete(authAttempts).where(eq(authAttempts.state, state)).run();
  if (!attempt) throw new Error("This authorization link is no longer valid. Start again.");
  if (attempt.expiresAt.getTime() < Date.now()) {
    throw new Error("The authorization took too long. Start again.");
  }
  return attempt;
}

function scopesToColumn(account: ConnectorAccount): string | null {
  return account.scopes?.length ? account.scopes.join(",") : null;
}

/**
 * Stores the result of a successful authorization. Re-authorizing the same
 * account updates the existing connection instead of creating a duplicate.
 */
export async function saveAuthorizedConnection(
  connectorId: ConnectorId,
  result: AuthResult,
): Promise<ConnectionView> {
  const existing = db()
    .select()
    .from(connections)
    .where(and(eq(connections.connectorId, connectorId), eq(connections.accountId, result.account.id)))
    .get();

  const id = existing?.id ?? randomUUID();
  await writeCredential(id, result.credential);

  const values = {
    connectorId,
    status: "connected" as const,
    accountId: result.account.id,
    accountLabel: result.account.label,
    accountUrl: result.account.url ?? null,
    avatarUrl: result.account.avatarUrl ?? null,
    scopes: scopesToColumn(result.account),
    lastError: null,
    updatedAt: new Date(),
  };

  if (existing) {
    db().update(connections).set(values).where(eq(connections.id, id)).run();
  } else {
    db().insert(connections).values({ id, ...values }).run();
  }
  const row = getConnection(id);
  if (!row) throw new Error("Failed to persist the connection");
  return toView(row);
}

export async function removeConnection(id: string): Promise<void> {
  const row = getConnection(id);
  if (!row) return;
  const runtime = connectorRuntime(row.connectorId);
  if (runtime.auth.revoke) {
    const credential = await readCredential<unknown>(id);
    if (credential) {
      try {
        await runtime.auth.revoke(credential);
      } catch {
        // Revoking is best effort; the local credential still goes away.
      }
    }
  }
  await deleteCredential(id);
  db().delete(connections).where(eq(connections.id, id)).run();
}

export function updateConnectionSettings(
  id: string,
  settings: ConnectionSettings,
): ConnectionView {
  db()
    .update(connections)
    .set({ settings, updatedAt: new Date() })
    .where(eq(connections.id, id))
    .run();
  const row = getConnection(id);
  if (!row) throw new Error("Connection not found");
  return toView(row);
}

/** Proves the stored credential still works and refreshes the shown account. */
export async function checkConnection(id: string): Promise<ConnectionView> {
  const row = getConnection(id);
  if (!row) throw new Error("Connection not found");
  const runtime = connectorRuntime(row.connectorId);
  const credential = await readCredential<unknown>(id);
  if (!credential) {
    db()
      .update(connections)
      .set({
        status: "needs_reauth",
        lastError: "No credential is stored for this connection.",
        updatedAt: new Date(),
      })
      .where(eq(connections.id, id))
      .run();
    return toView(getConnection(id)!);
  }
  try {
    const account = await runtime.auth.identity(credential);
    db()
      .update(connections)
      .set({
        status: "connected",
        accountLabel: account.label,
        accountUrl: account.url ?? null,
        avatarUrl: account.avatarUrl ?? null,
        scopes: scopesToColumn(account),
        lastError: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, id))
      .run();
  } catch (error) {
    db()
      .update(connections)
      .set({
        status: "needs_reauth",
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, id))
      .run();
  }
  return toView(getConnection(id)!);
}
