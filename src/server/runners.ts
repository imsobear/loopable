import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { RunnerInventoryEntry, RunnerView } from "#/lib/domain.ts";
import { LEGACY_RUNNER_PROTOCOL, RUNNER_PROTOCOL, VERSION, olderThan } from "#/lib/version.ts";
import { db } from "./db/client.ts";
import { runners, tasks, workspaces, type Runner } from "./db/schema.ts";
import { isHosted } from "#/lib/hosted.ts";
import { runnerLimitReached } from "./limits.ts";
import { joinTokenKey, runnerTokenKey, secretStore } from "./secrets.ts";
import { LOCAL_WORKSPACE, workspaceId } from "./workspace.ts";

/** Tokens are stored and looked up by their hash, never as they are. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** This workspace's runners only. */
function mine() {
  return eq(runners.workspaceId, workspaceId());
}

const ONLINE_MS = 45_000;

/** What a runner says it is, as it says it on joining and on every heartbeat. */
export type RunnerBuild = { version?: string | null; protocol?: number | null };

export function protocolOf(row: Pick<Runner, "protocol">): number {
  return row.protocol ?? LEGACY_RUNNER_PROTOCOL;
}

function buildFields(build: RunnerBuild) {
  return {
    version: typeof build.version === "string" && build.version ? build.version : null,
    protocol: typeof build.protocol === "number" ? build.protocol : null,
  };
}

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
    version: row.version,
    protocol: protocolOf(row),
    outdated: protocolOf(row) < RUNNER_PROTOCOL || olderThan(row.version, VERSION),
  };
}

export async function listRunners(): Promise<RunnerView[]> {
  await db().delete(runners).where(eq(runners.id, "host")).run();
  const now = Date.now();
  return (await db().select().from(runners).where(mine()).all()).map((row) => toView(row, now));
}

export async function getRunner(id: string): Promise<Runner | undefined> {
  return await db().select().from(runners).where(and(mine(), eq(runners.id, id))).get();
}

export async function onlineRunnerCount(): Promise<number> {
  return (await listRunners()).filter((row) => row.status === "online").length;
}

function runnerCanRun(row: Runner, agentId: string): boolean {
  const entry = row.inventory.find((item) => item.agentId === agentId);
  return Boolean(entry?.installed && entry.signedIn);
}

async function busyRunnerIds(): Promise<Set<string>> {
  const rows = await db()
    .select({ runnerId: tasks.runnerId })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId()),
        inArray(tasks.state, ["awaiting_agent", "preparing", "applying"]),
      ),
    )
    .all();
  return new Set(rows.flatMap((row) => (row.runnerId ? [row.runnerId] : [])));
}

/** Agent ids signed in on an online runner. */
export async function availableAgentIds(requiresHost = false, minProtocol = 0): Promise<string[]> {
  const local = osHostname();
  return [
    ...new Set(
      (await listRunners())
        .filter(
          (row) =>
            row.status === "online" &&
            (!requiresHost || row.hostname === local) &&
            row.protocol >= minProtocol,
        )
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
 * disk only go to a runner whose hostname is this host, and a job that needs
 * something newer runners understand only goes to one that says it does.
 */
export async function pickRunner(input: {
  agentId: string;
  requiresHost: boolean;
  minProtocol?: number;
}): Promise<string> {
  const now = Date.now();
  const local = osHostname();
  const minProtocol = input.minProtocol ?? 0;
  const capable = (await db().select().from(runners).where(mine()).all()).filter(
    (row) => isRunnerOnline(row, now) && runnerCanRun(row, input.agentId),
  );
  let candidates = capable.filter((row) => protocolOf(row) >= minProtocol);
  if (input.requiresHost) {
    candidates = candidates.filter((row) => row.hostname === local);
  }

  const busy = await busyRunnerIds();
  const idle = candidates.find((row) => !busy.has(row.id));
  const chosen = idle ?? candidates[0];
  if (chosen) return chosen.id;
  if (input.requiresHost) {
    throw new Error("This job needs a runner on the same host as Loopable.");
  }
  if (capable.length > 0) {
    throw new Error(
      "Every runner with this agent is too old for this job. Upgrade them with npm install -g loopable-cli.",
    );
  }
  throw new Error("No runner is online that can run this agent.");
}

/**
 * The token a runner joins this workspace with. Kept as it is in the secret
 * store, so the Runners page can show it, and as a hash on the workspace, so a
 * join finds its workspace in one lookup.
 */
export async function getJoinToken(): Promise<string> {
  const workspace = workspaceId();
  const existing = await secretStore().get(joinTokenKey(workspace));
  if (existing) {
    await rememberJoinToken(workspace, existing);
    return existing;
  }
  return await rotateJoinToken();
}

export async function rotateJoinToken(): Promise<string> {
  const workspace = workspaceId();
  const token = randomBytes(24).toString("base64url");
  await secretStore().set(joinTokenKey(workspace), token);
  await rememberJoinToken(workspace, token);
  return token;
}

async function rememberJoinToken(workspace: string, token: string): Promise<void> {
  await db()
    .update(workspaces)
    .set({ joinTokenHash: tokenHash(token) })
    .where(eq(workspaces.id, workspace))
    .run();
}

/** Which workspace a join token belongs to, or null when it is nobody's. */
async function workspaceForJoinToken(token: string): Promise<string | null> {
  if (!token) return null;
  const row = await db()
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.joinTokenHash, tokenHash(token)))
    .get();
  if (row) return row.id;
  // A local install from before workspaces kept its token only in the secret
  // store, so nothing has been hashed yet.
  if (!isHosted() && token === (await secretStore().get(joinTokenKey(LOCAL_WORKSPACE)))) {
    await rememberJoinToken(LOCAL_WORKSPACE, token);
    return LOCAL_WORKSPACE;
  }
  return null;
}

export async function heartbeatRunner(
  runnerId: string,
  inventory: RunnerInventoryEntry[],
  build: RunnerBuild = {},
): Promise<RunnerView> {
  const row = await getRunner(runnerId);
  if (!row) throw new Error("Unknown runner.");
  await db()
    .update(runners)
    .set({ status: "online", inventory, lastSeenAt: new Date(), ...buildFields(build) })
    .where(and(mine(), eq(runners.id, runnerId)))
    .run();
  return toView((await getRunner(runnerId))!);
}

/**
 * A runner joining with a workspace's join token. Not scoped: the token is
 * what says which workspace, and the runner is added there.
 */
export async function joinRunner(input: {
  joinToken: string;
  hostname: string;
  inventory: RunnerInventoryEntry[];
} & RunnerBuild): Promise<{ runnerId: string; runnerToken: string; name: string }> {
  const workspace = await workspaceForJoinToken(input.joinToken);
  if (!workspace) throw new Error("That join token is not valid.");

  // The same machine joining again is the same runner, not another one.
  const existing = await db()
    .select()
    .from(runners)
    .where(and(eq(runners.workspaceId, workspace), eq(runners.hostname, input.hostname)))
    .get();
  if (!existing) {
    const limit = await runnerLimitReached(workspace);
    if (limit) throw new Error(limit);
  }
  const id = existing?.id ?? randomUUID();
  const name = existing?.name ?? input.hostname;
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  if (existing) {
    await db()
      .update(runners)
      .set({
        status: "online",
        inventory: input.inventory,
        lastSeenAt: now,
        hostname: input.hostname,
        tokenHash: tokenHash(token),
        ...buildFields(input),
      })
      .where(eq(runners.id, id))
      .run();
  } else {
    await db()
      .insert(runners)
      .values({
        id,
        workspaceId: workspace,
        name,
        hostname: input.hostname,
        status: "online",
        inventory: input.inventory,
        lastSeenAt: now,
        tokenHash: tokenHash(token),
        ...buildFields(input),
      })
      .run();
  }
  // Kept in the secret store too, for an older Loopable reading this database.
  if (!isHosted()) await secretStore().set(runnerTokenKey(id), token);
  return { runnerId: id, runnerToken: token, name };
}

/**
 * The runner a request comes from, by its token. Not scoped: the token is the
 * only thing a runner's request carries, and the row it finds says whose
 * runner it is.
 */
export async function runnerForToken(token: string): Promise<Runner | null> {
  if (!token) return null;
  const found = await db().select().from(runners).where(eq(runners.tokenHash, tokenHash(token))).get();
  if (found) return found;
  // Runners that joined before tokens were hashed: compare the old way, once.
  for (const row of await db().select().from(runners).where(isNull(runners.tokenHash)).all()) {
    const stored =
      (await secretStore().get(runnerTokenKey(row.id))) ??
      (await secretStore().get(`runners.machine.${row.id}`));
    if (stored && stored === token) {
      await db().update(runners).set({ tokenHash: tokenHash(token) }).where(eq(runners.id, row.id)).run();
      return { ...row, tokenHash: tokenHash(token) };
    }
  }
  return null;
}

export async function runnerIdForToken(token: string): Promise<string | null> {
  return (await runnerForToken(token))?.id ?? null;
}

export async function forgetRunner(id: string): Promise<void> {
  const row = await getRunner(id);
  if (!row) throw new Error("Unknown runner.");
  const inflight = await db()
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId()),
        eq(tasks.runnerId, id),
        eq(tasks.state, "awaiting_agent"),
      ),
    )
    .get();
  if (inflight) throw new Error("This runner still has a run in flight.");
  await db().delete(runners).where(and(mine(), eq(runners.id, id))).run();
  await secretStore().delete(runnerTokenKey(id));
  await secretStore().delete(`runners.machine.${id}`);
}
