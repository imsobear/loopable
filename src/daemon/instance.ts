import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { daemonPidPath } from "#/server/paths.ts";

function isAlive(pid: number): boolean {
  try {
    // Signal 0 asks the kernel whether we could signal the process, which is
    // the standard way to check a pid without disturbing it.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else, which still counts.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Two daemons on one database would fight over every task. A pid file is
 * enough here: both processes belong to the same person on the same machine,
 * and a stale file is easy to tell from a live one.
 */
export function claimSingleInstance(): { ok: true } | { ok: false; pid: number } {
  const path = daemonPidPath();
  if (existsSync(path)) {
    const existing = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (Number.isInteger(existing) && existing !== process.pid && isAlive(existing)) {
      return { ok: false, pid: existing };
    }
  }
  writeFileSync(path, String(process.pid), "utf8");
  return { ok: true };
}

export function releaseSingleInstance(): void {
  const path = daemonPidPath();
  if (!existsSync(path)) return;
  const owner = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  if (owner === process.pid) rmSync(path);
}

/** What the app shows when it needs to say whether the engine is up. */
export function runningDaemonPid(): number | null {
  const path = daemonPidPath();
  if (!existsSync(path)) return null;
  const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return Number.isInteger(pid) && isAlive(pid) ? pid : null;
}
