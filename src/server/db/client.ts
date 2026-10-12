import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dbPath } from "../paths.ts";
import * as schema from "./schema.ts";

type Db = ReturnType<typeof create>;

function databaseUrl(): string {
  if (process.env.LOOPABLE_DATABASE_URL) return process.env.LOOPABLE_DATABASE_URL;
  return pathToFileURL(dbPath()).href;
}

function create() {
  const client = createClient({
    url: databaseUrl(),
    authToken: process.env.LOOPABLE_DATABASE_AUTH_TOKEN,
    // A local file is shared by the app and the dispatcher, two processes.
    // Every pooled connection waits out a moment's lock instead of failing.
    timeout: 5_000,
  });
  // WAL lets one process read while the other writes. Without it a reader can
  // hold up a writer's commit, and a new file starts without it. It is kept in
  // the file, so setting it once on any connection is enough.
  if (client.protocol === "file") void client.execute("PRAGMA journal_mode = WAL").catch(() => {});
  return drizzle(client, { schema });
}

function migrationsFolder(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(here, "../drizzle"),
    join(here, "../../../drizzle"),
    join(process.cwd(), "drizzle"),
  ];
  return candidates.find((folder) => existsSync(folder)) ?? join(process.cwd(), "drizzle");
}

/**
 * The dispatcher applies migrations. The App Worker has no drizzle folder on disk
 * in production, and must not race the dispatcher on a fresh database.
 */
export async function migrateIfNeeded(): Promise<void> {
  if (process.env.LOOPABLE_SKIP_MIGRATE === "1") return;
  const folder = migrationsFolder();
  if (!existsSync(folder)) return;
  await migrate(db(), { migrationsFolder: folder });
}

export function rowsChanged(result: { rowsAffected?: number; changes?: number }): number {
  return Number(result.rowsAffected ?? result.changes ?? 0);
}

const cache = globalThis as typeof globalThis & { __loopableDb?: Db };

export function db(): Db {
  cache.__loopableDb ??= create();
  return cache.__loopableDb;
}
