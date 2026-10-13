import { count, eq } from "drizzle-orm";
import { isHosted } from "#/lib/hosted.ts";
import { db } from "./db/client.ts";
import { loops, runners } from "./db/schema.ts";
import { workspaceId } from "./workspace.ts";

/**
 * What one workspace may use of the hosted service. Not a price list: a way to
 * keep polling and storage bounded while there is no pricing, so one busy
 * workspace cannot slow everyone else down. `pnpm dev` has none.
 */
export type Limits = {
  /** Loops in one workspace. */
  loops: number;
  /** Runners joined to one workspace. */
  runners: number;
  /** The shortest time between two looks at one loop. */
  minPollMs: number;
};

function fromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function limits(): Limits | null {
  if (!isHosted()) return null;
  return {
    loops: fromEnv("LOOPABLE_LIMIT_LOOPS", 20),
    runners: fromEnv("LOOPABLE_LIMIT_RUNNERS", 5),
    minPollMs: fromEnv("LOOPABLE_LIMIT_MIN_POLL_MS", 60_000),
  };
}

/** Why another loop cannot be made in this workspace, or null when it can. */
export async function loopLimitReached(): Promise<string | null> {
  const cap = limits()?.loops;
  if (!cap) return null;
  const row = await db().select({ n: count() }).from(loops).where(eq(loops.workspaceId, workspaceId())).get();
  return (row?.n ?? 0) >= cap ? `A workspace can have up to ${cap} loops for now.` : null;
}

/** Why another runner cannot join this workspace, or null when it can. */
export async function runnerLimitReached(workspace: string): Promise<string | null> {
  const cap = limits()?.runners;
  if (!cap) return null;
  const row = await db().select({ n: count() }).from(runners).where(eq(runners.workspaceId, workspace)).get();
  return (row?.n ?? 0) >= cap
    ? `A workspace can have up to ${cap} runners for now. Forget one on the Runners page first.`
    : null;
}

/** How long a loop waits between looks, with the hosted floor applied. */
export function pollInterval(asked: number | null): number | null {
  const floor = limits()?.minPollMs;
  if (!floor) return asked;
  return Math.max(asked ?? 0, floor);
}
