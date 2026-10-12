import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "./db/client.ts";
import { runnerLogins, workspaces } from "./db/schema.ts";
import { getJoinToken } from "./runners.ts";
import { withWorkspace, workspaceId } from "./workspace.ts";

/**
 * `loopable login`: a runner joins your workspace without you copying a token.
 *
 * The CLI asks for a code and shows it; you open the link, signed in, and
 * approve the same code; the CLI, which has been asking all along, is handed
 * your workspace's join token. The code is what you compare on both screens.
 * The poll secret never leaves the CLI, so a code someone else sees is no use
 * to them.
 */
const TTL_MS = 10 * 60 * 1000;
// No 0/O or 1/I, so a code read off a screen is typed right the first time.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newCode(): string {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

/** Normalised so "abcd efgh" typed by hand finds "ABCD-EFGH". */
export function normalizeCode(code: string): string {
  const plain = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return plain.length === 8 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain;
}

export async function startRunnerLogin(): Promise<{ code: string; pollSecret: string; expiresInMs: number }> {
  const now = Date.now();
  await db().delete(runnerLogins).where(lt(runnerLogins.expiresAt, new Date(now))).run();
  const code = newCode();
  const pollSecret = randomBytes(24).toString("base64url");
  await db()
    .insert(runnerLogins)
    .values({ code, pollSecretHash: hash(pollSecret), expiresAt: new Date(now + TTL_MS) })
    .run();
  return { code, pollSecret, expiresInMs: TTL_MS };
}

export type RunnerLoginState = "pending" | "approved" | "expired" | "unknown";

/** What the approval page shows about a code, before anyone approves it. */
export async function describeRunnerLogin(code: string): Promise<RunnerLoginState> {
  const row = await db()
    .select()
    .from(runnerLogins)
    .where(eq(runnerLogins.code, normalizeCode(code)))
    .get();
  if (!row) return "unknown";
  if (row.expiresAt.getTime() < Date.now()) return "expired";
  return row.approvedAt ? "approved" : "pending";
}

/** Approve a code into the workspace in scope, which is the signed-in person's. */
export async function approveRunnerLogin(code: string): Promise<void> {
  const state = await describeRunnerLogin(code);
  if (state === "unknown") throw new Error("There is no login waiting with that code.");
  if (state === "expired") throw new Error("That code has expired. Run loopable login again.");
  if (state === "approved") throw new Error("That code has already been used.");
  await db()
    .update(runnerLogins)
    .set({ workspaceId: workspaceId(), approvedAt: new Date() })
    .where(and(eq(runnerLogins.code, normalizeCode(code)), isNull(runnerLogins.approvedAt)))
    .run();
}

export type RunnerLoginPoll =
  | { state: "pending" | "expired" }
  | { state: "approved"; joinToken: string; workspace: string };

/**
 * The CLI asking whether its code has been approved. Answers once with the
 * join token and then forgets the login, so it cannot be collected twice.
 */
export async function pollRunnerLogin(code: string, pollSecret: string): Promise<RunnerLoginPoll> {
  const row = await db()
    .select()
    .from(runnerLogins)
    .where(eq(runnerLogins.code, normalizeCode(code)))
    .get();
  if (!row || row.pollSecretHash !== hash(pollSecret)) return { state: "expired" };
  if (row.expiresAt.getTime() < Date.now()) return { state: "expired" };
  if (!row.approvedAt || !row.workspaceId) return { state: "pending" };

  await db().delete(runnerLogins).where(eq(runnerLogins.code, row.code)).run();
  const workspace = row.workspaceId;
  const joinToken = await withWorkspace(workspace, () => getJoinToken());
  const named = await db().select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspace)).get();
  return { state: "approved", joinToken, workspace: named?.name ?? workspace };
}
