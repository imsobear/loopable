import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { enginePidPath } from "#/server/paths.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Two engines on one database would fight over every task. A pid file is
 * enough here: both processes belong to the same person on the same host.
 */
export function claimSingleInstance(): { ok: true } | { ok: false; pid: number } {
  const path = enginePidPath();
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
  const path = enginePidPath();
  if (!existsSync(path)) return;
  const owner = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  if (owner === process.pid) rmSync(path);
}

export function runningEnginePid(): number | null {
  const path = enginePidPath();
  if (!existsSync(path)) return null;
  const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return Number.isInteger(pid) && isAlive(pid) ? pid : null;
}
