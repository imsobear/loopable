import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function appRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function dataDir(): string {
  const dir = process.env.LOOPABLE_HOME ?? join(homedir(), ".loopable");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(dataDir(), "state.sqlite");
}

export function worktreeRoot(): string {
  const dir = join(dataDir(), "worktrees");
  mkdirSync(dir, { recursive: true });
  return dir;
}
