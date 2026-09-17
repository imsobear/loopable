import { randomBytes, randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { eq } from "drizzle-orm";
import type { RunnerInventoryEntry, RunnerView } from "#/lib/domain.ts";
import { db } from "./db/client.ts";
import { runners, tasks, type Runner } from "./db/schema.ts";
import { joinTokenKey, runnerTokenKey, secretStore } from "./secrets.ts";

const ONLINE_MS = 45_000;

export function isRunnerOnline(row: Runner, now = Date.now()): boolean {
  if (row.status !== "online") return false;
  if (!row.lastSeenAt) return false;
  return now - row.lastSeenAt.getTime() < ONLINE_MS;
}

function toView(row: Runner, now = Date.now()): RunnerView {
  const online = isRunnerOnline(row, now);
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    status: online ? "online" : "offline",
    inventory: row.inventory,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

export function listRunners(): RunnerView[] {
  db().delete(runners).where(eq(runners.id, "host")).run();
  const now = Date.now();
  return db()
    .select()
    .from(runners)
    .all()
    .map((row) => toView(row, now));
}

export function getRunner(id: string): Runner | undefined {
  return db().select().from(runners).where(eq(runners.id, id)).get();
}

export function onlineRunnerCount(): number {
  return listRunners().filter((row) => row.status === "online").length;
}

function runnerCanRun(row: Runner, agentId: string): boolean {
  const entry = row.inventory.find((item) => item.agentId === agentId);
  return Boolean(entry?.installed && entry.signedIn);
}

function busyRunnerIds(): Set<string> {
  return new Set(
    db()
      .select({ runnerId: tasks.runnerId, state: tasks.state })
      .from(tasks)
      .all()
      .flatMap((row) => {
        if (
          !row.runnerId ||
          (row.state !== "awaiting_agent" && row.state !== "preparing" && row.state !== "applying")
        ) {
          return [];
        }
        return [row.runnerId];
      }),
  );
}

/** Agent ids signed in on an online runner. */
export function availableAgentIds(requiresHost = false): string[] {
  const local = osHostname();
  return [
    ...new Set(
      listRunners()
        .filter((row) => row.status === "online" && (!requiresHost || row.hostname === local))
        .flatMap((row) =>
          row.inventory
            .filter((entry) => entry.installed && entry.signedIn)
            .map((entry) => entry.agentId),
        ),
    ),
  ];
}

/**
 * Which runner should run this agent. Jobs that need a folder on Loopable's
 * disk only go to a runner whose hostname is this host.
 */
export function pickRunner(input: { agentId: string; requiresHost: boolean }): string {
  const now = Date.now();
  const local = osHostname();
  let candidates = db()
    .select()
    .from(runners)
    .all()
    .filter((row) => isRunnerOnline(row, now) && runnerCanRun(row, input.agentId));
  if (input.requiresHost) {
    candidates = candidates.filter((row) => row.hostname === local);
  }

  const busy = busyRunnerIds();
  const idle = candidates.find((row) => !busy.has(row.id));
  const chosen = idle ?? candidates[0];
  if (chosen) return chosen.id;
  if (input.requiresHost) {
    throw new Error("This job needs a runner on the same host as Loopable.");
  }
  throw new Error("No runner is online that can run this agent.");
}

export async function getJoinToken(): Promise<string> {
  const existing = await secretStore().get(joinTokenKey());
  if (existing) return existing;
  const token = randomBytes(24).toString("base64url");
  await secretStore().set(joinTokenKey(), token);
  return token;
}

export async function rotateJoinToken(): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await secretStore().set(joinTokenKey(), token);
  return token;
}

export function heartbeatRunner(runnerId: string, inventory: RunnerInventoryEntry[]): RunnerView {
  const row = getRunner(runnerId);
  if (!row) throw new Error("Unknown runner.");
  db()
    .update(runners)
    .set({ status: "online", inventory, lastSeenAt: new Date() })
    .where(eq(runners.id, runnerId))
    .run();
  return toView(getRunner(runnerId)!);
}

export async function joinRunner(input: {
  joinToken: string;
  hostname: string;
  inventory: RunnerInventoryEntry[];
}): Promise<{ runnerId: string; runnerToken: string; name: string }> {
  const expected = await getJoinToken();
  if (!input.joinToken || input.joinToken !== expected) {
    throw new Error("That join token is not valid.");
  }
  const existing = db()
    .select()
    .from(runners)
    .all()
    .find((row) => row.hostname === input.hostname);
  const id = existing?.id ?? randomUUID();
  const name = existing?.name ?? input.hostname;
  const now = new Date();
  if (existing) {
    db()
      .update(runners)
      .set({
        status: "online",
        inventory: input.inventory,
        lastSeenAt: now,
        hostname: input.hostname,
      })
      .where(eq(runners.id, id))
      .run();
  } else {
    db()
      .insert(runners)
      .values({
        id,
        name,
        hostname: input.hostname,
        status: "online",
        inventory: input.inventory,
        lastSeenAt: now,
      })
      .run();
  }
  const token = randomBytes(24).toString("base64url");
  await secretStore().set(runnerTokenKey(id), token);
  return { runnerId: id, runnerToken: token, name };
}

export async function runnerIdForToken(token: string): Promise<string | null> {
  if (!token) return null;
  for (const row of db().select().from(runners).all()) {
    const stored =
      (await secretStore().get(runnerTokenKey(row.id))) ??
      (await secretStore().get(`runners.machine.${row.id}`));
    if (stored && stored === token) return row.id;
  }
  return null;
}

export async function forgetRunner(id: string): Promise<void> {
  const row = getRunner(id);
  if (!row) throw new Error("Unknown runner.");
  const inflight = db()
    .select()
    .from(tasks)
    .all()
    .some((task) => task.runnerId === id && task.state === "awaiting_agent");
  if (inflight) throw new Error("This runner still has a run in flight.");
  db().delete(runners).where(eq(runners.id, id)).run();
  await secretStore().delete(runnerTokenKey(id));
  await secretStore().delete(`runners.machine.${id}`);
}
