import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
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

/** This workspace's runners that have not been forgotten. */
function kept() {
  return and(mine(), isNull(runners.forgottenAt));
}

const ONLINE_MS = 45_000;

/** What a runner says it is, as it says it on joining and on every heartbeat. */
export type RunnerBuild = {
  version?: string | null;
  protocol?: number | null;
  updatable?: boolean | null;
  /** Why its last update failed, said once on the heartbeat after. */
  updateError?: string | null;
};

/** What Loopable asks of a runner on a heartbeat or a claim. */
export type RunnerInstruction = { kind: "stop"; reason: string } | { kind: "update"; version: string };

export function protocolOf(row: Pick<Runner, "protocol">): number {
  return row.protocol ?? LEGACY_RUNNER_PROTOCOL;
}

function buildFields(build: RunnerBuild) {
  return {
    version: typeof build.version === "string" && build.version ? build.version : null,
    protocol: typeof build.protocol === "number" ? build.protocol : null,
    ...(typeof build.updatable === "boolean" ? { updatable: build.updatable } : {}),
    ...(typeof build.updateError === "string" && build.updateError
      ? { updateError: build.updateError.slice(0, 500) }
      : {}),
  };
}

const UPDATE_MS = 3 * 60_000;
let latest: { version: string; at: number } | null = null;

/**
 * The newest loopable-cli on npm, which is what a runner can update to. Asked
 * at most every ten minutes; this App's own version when npm cannot be asked.
 */
export async function latestRunnerVersion(): Promise<string> {
  if (latest && Date.now() - latest.at < 10 * 60_000) return latest.version;
  try {
    const res = await fetch("https://registry.npmjs.org/loopable-cli/latest", {
      signal: AbortSignal.timeout(3_000),
    });
    const body = (await res.json()) as { version?: string };
    if (res.ok && typeof body.version === "string") {
      latest = { version: body.version, at: Date.now() };
      return body.version;
    }
  } catch {
    // Offline or slow: fall through to what this App knows.
  }
  return latest?.version ?? VERSION;
}

export function isRunnerOnline(row: Runner, now = Date.now()): boolean {
  if (row.status !== "online") return false;
  if (!row.lastSeenAt) return false;
  return now - row.lastSeenAt.getTime() < ONLINE_MS;
}

function toView(row: Runner, now = Date.now(), newest = VERSION): RunnerView {
  const online = isRunnerOnline(row, now);
  const updating =
    online &&
    row.updateRequestedAt !== null &&
    now - row.updateRequestedAt.getTime() < UPDATE_MS &&
    olderThan(row.version, row.updateTo ?? newest) &&
    !row.updateError;
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    status: online ? "online" : "offline",
    inventory: row.inventory,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    version: row.version,
    protocol: protocolOf(row),
    outdated: protocolOf(row) < RUNNER_PROTOCOL || olderThan(row.version, newest),
    latest: newest,
    enabled: row.enabled,
    updatable: row.updatable === true,
    updating,
    updateError: row.updateError,
  };
}

export async function listRunners(newest = VERSION): Promise<RunnerView[]> {
  await db().delete(runners).where(eq(runners.id, "host")).run();
  const now = Date.now();
  return (await db().select().from(runners).where(kept()).all()).map((row) => toView(row, now, newest));
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
            row.enabled &&
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
  const capable = (await db().select().from(runners).where(kept()).all()).filter(
    (row) => row.enabled && isRunnerOnline(row, now) && runnerCanRun(row, input.agentId),
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
 * What to tell a runner now, if anything. Each is said once: a forgotten
 * runner is removed once it has been told to stop, and an update is asked for
 * once, so a runner that cannot update is not asked again on every beat.
 */
export async function instructionFor(runnerId: string): Promise<RunnerInstruction | null> {
  const row = await getRunner(runnerId);
  if (!row) return null;
  if (row.forgottenAt) {
    await removeRunnerRow(row.id);
    return { kind: "stop", reason: "This runner was forgotten in Loopable." };
  }
  if (row.updateTo) {
    await db().update(runners).set({ updateTo: null }).where(eq(runners.id, row.id)).run();
    if (olderThan(row.version, row.updateTo)) return { kind: "update", version: row.updateTo };
  }
  return null;
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
  // Joining again after being forgotten is a fresh start, switched on.
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
        forgottenAt: null,
        updateError: null,
        ...(existing.forgottenAt ? { enabled: true } : {}),
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

/**
 * Jobs given to a runner that has not started them yet, put back in the queue
 * so another runner takes them. One it has started stays with it.
 */
async function releaseWaitingJobs(runnerId: string): Promise<void> {
  await db()
    .update(tasks)
    .set({ state: "queued", runnerId: null, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.workspaceId, workspaceId()),
        eq(tasks.runnerId, runnerId),
        eq(tasks.state, "awaiting_agent"),
        or(isNull(tasks.leaseUntil), lte(tasks.leaseUntil, new Date())),
      ),
    )
    .run();
}

async function removeRunnerRow(id: string): Promise<void> {
  await db().delete(runners).where(eq(runners.id, id)).run();
  await secretStore().delete(runnerTokenKey(id));
  await secretStore().delete(`runners.machine.${id}`);
}

/**
 * Stops a runner and forgets it. One that is online is told to stop on its
 * next check-in, finishing the run it is on first; one that is not is simply
 * removed.
 */
export async function forgetRunner(id: string): Promise<void> {
  const row = await getRunner(id);
  if (!row || row.forgottenAt) throw new Error("Unknown runner.");
  await releaseWaitingJobs(id);
  if (isRunnerOnline(row)) {
    await db().update(runners).set({ forgottenAt: new Date() }).where(and(mine(), eq(runners.id, id))).run();
  } else {
    await removeRunnerRow(id);
  }
}

/** Off: still connected, given no new jobs, and its waiting ones go to another runner. */
export async function setRunnerEnabled(id: string, enabled: boolean): Promise<void> {
  const row = await getRunner(id);
  if (!row || row.forgottenAt) throw new Error("Unknown runner.");
  await db().update(runners).set({ enabled }).where(and(mine(), eq(runners.id, id))).run();
  if (!enabled) await releaseWaitingJobs(id);
}

/** Asks a runner to update itself to the newest loopable-cli on its next check-in. */
export async function requestRunnerUpdate(id: string): Promise<void> {
  const row = await getRunner(id);
  if (!row || row.forgottenAt) throw new Error("Unknown runner.");
  if (!isRunnerOnline(row)) throw new Error(`${row.name} is offline, so it cannot update now.`);
  if (row.updatable !== true) {
    throw new Error(`${row.name} cannot update itself. On that machine, run npm install -g loopable-cli.`);
  }
  const version = await latestRunnerVersion();
  if (!olderThan(row.version, version)) throw new Error(`${row.name} is already on v${row.version}.`);
  await db()
    .update(runners)
    .set({ updateTo: version, updateRequestedAt: new Date(), updateError: null })
    .where(and(mine(), eq(runners.id, id)))
    .run();
}
