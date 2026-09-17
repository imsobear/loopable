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

/**
 * Where a run keeps its scratch files and its log. Not the system temp
 * directory: the engine writes these and the app reads them, they are the
 * first thing to look at when a run goes wrong, and temp gets swept.
 */
export function runDir(taskId: string): string {
  const dir = join(dataDir(), "runs", taskId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function enginePidPath(): string {
  return join(dataDir(), "engine.pid");
}
