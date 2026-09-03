import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  const dir = process.env.LOOPABLE_HOME ?? join(homedir(), ".loopable");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return process.env.LOOPABLE_DB ?? join(dataDir(), "loopable.sqlite");
}
