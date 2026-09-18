import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function isDevProfile(): boolean {
  return process.env.LOOPABLE_DEV === "1";
}

export function dataDir(): string {
  const dir = process.env.LOOPABLE_HOME ?? join(homedir(), isDevProfile() ? ".loopable-dev" : ".loopable");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return process.env.LOOPABLE_DB ?? join(dataDir(), "loopable.sqlite");
}

/** Keychain service prefix. Dev must not read or write the deploy install's secrets. */
export function secretNamespace(): string {
  return process.env.LOOPABLE_SECRET_PREFIX ?? (isDevProfile() ? "loopable-dev" : "loopable");
}

/**
 * Where a run keeps its scratch files and its log. Not the system temp
 * directory: the dispatcher writes these and the app reads them, they are the
 * first thing to look at when a run goes wrong, and temp gets swept.
 */
export function runDir(taskId: string): string {
  const dir = join(dataDir(), "runs", taskId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
