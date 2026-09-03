import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath } from "../paths.ts";
import * as schema from "./schema.ts";

type Db = ReturnType<typeof create>;

function create() {
  const sqlite = new Database(dbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // The app and the daemon are separate processes on one file. WAL lets them
  // read while the other writes; this is how the writer waits its turn instead
  // of failing outright.
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  runMigrations(db);
  return db;
}

/**
 * The app and the daemon can both start on a fresh database at the same time.
 * Whoever loses the race sees the tables appear underneath it, and by the time
 * it looks again the journal says there is nothing left to do.
 */
function runMigrations(db: ReturnType<typeof drizzle>): void {
  try {
    migrate(db, { migrationsFolder: migrationsFolder() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|locked|busy/i.test(message)) throw error;
    migrate(db, { migrationsFolder: migrationsFolder() });
  }
}

/**
 * Resolved from this file rather than the working directory, because the
 * daemon is started from wherever the user happens to be.
 */
function migrationsFolder(): string {
  const beside = fileURLToPath(new URL("../../../drizzle", import.meta.url));
  return existsSync(beside) ? beside : join(process.cwd(), "drizzle");
}

// Vite reloads server modules on edit, and each reload would otherwise open a
// new handle to the same file and re-run migrations.
const cache = globalThis as typeof globalThis & { __loopableDb?: Db };

export function db(): Db {
  cache.__loopableDb ??= create();
  return cache.__loopableDb;
}
