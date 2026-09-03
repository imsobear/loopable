import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { dbPath } from "../paths.ts";
import * as schema from "./schema.ts";

type Db = ReturnType<typeof create>;

function create() {
  const sqlite = new Database(dbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  return db;
}

// Vite reloads server modules on edit, and each reload would otherwise open a
// new handle to the same file and re-run migrations.
const cache = globalThis as typeof globalThis & { __loopableDb?: Db };

export function db(): Db {
  cache.__loopableDb ??= create();
  return cache.__loopableDb;
}
