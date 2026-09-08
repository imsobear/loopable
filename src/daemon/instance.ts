import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { daemonPidPath } from "#/server/paths.ts";

/** How often the daemon says it is still there. */
export const HEARTBEAT_MS = 10_000;

/**
 * How long a heartbeat is believed. Three beats, because one missed beat is a
 * busy machine and three is a process that is gone.
 */
export const STALE_MS = HEARTBEAT_MS * 3;

type Claim = { pid: number; at: number };

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

function read(): Claim | null {
  const path = daemonPidPath();
  if (!existsSync(path)) return null;
  try {
    const claim = JSON.parse(readFileSync(path, "utf8")) as Partial<Claim>;
    if (!Number.isInteger(claim.pid) || !Number.isFinite(claim.at)) return null;
    return { pid: claim.pid as number, at: claim.at as number };
  } catch {
    // An unreadable claim is no claim. Whoever starts next overwrites it.
    return null;
  }
}

/**
 * Whether a claim is one we should believe. A pid on its own is not enough:
 * pids get reused, so a dead daemon's number can end up on somebody's editor
 * and then that claim would be believed forever. A daemon that is really
 * running says so every few seconds, and only a recent word counts.
 */
function held(claim: Claim, now: number): boolean {
  return isAlive(claim.pid) && now - claim.at < STALE_MS;
}

/** Writes down that this process is the daemon, as of right now. */
export function beat(): void {
  const claim: Claim = { pid: process.pid, at: Date.now() };
  writeFileSync(daemonPidPath(), JSON.stringify(claim), "utf8");
}

/**
 * Two daemons on one database would fight over every task. A claim file is
 * enough here: both processes belong to the same person on the same machine.
 */
export function claimSingleInstance(): { ok: true } | { ok: false; pid: number } {
  const claim = read();
  if (claim && claim.pid !== process.pid && held(claim, Date.now())) {
    return { ok: false, pid: claim.pid };
  }
  beat();
  return { ok: true };
}

export function releaseSingleInstance(): void {
  const claim = read();
  if (claim?.pid === process.pid) rmSync(daemonPidPath());
}

/** What the app shows when it needs to say whether the engine is up. */
export function runningDaemonPid(): number | null {
  const claim = read();
  if (!claim) return null;
  return held(claim, Date.now()) ? claim.pid : null;
}
