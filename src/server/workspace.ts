import { AsyncLocalStorage } from "node:async_hooks";
import { isHosted } from "#/lib/hosted.ts";

/**
 * Whose data a piece of work is about.
 *
 * Every request, every poll of a loop and every run of a task happens inside
 * one workspace, and every query is filtered by it. The scope is set once, at
 * the edge (a signed-in request, a runner's token, a loop or task row the
 * dispatcher picked up), rather than passed down through every function,
 * because a parameter someone forgets to pass is a query that quietly returns
 * everyone's rows.
 *
 * Asking with no scope set is an error when hosted, so a forgotten scope fails
 * loudly instead of reading across workspaces. On a local install there is
 * only one workspace, so it is the answer.
 */
export type Scope = { workspaceId: string; userId: string | null };

/** The one workspace of a local install, and of everything made before workspaces. */
export const LOCAL_WORKSPACE = "local";

/** Settings that belong to the dispatcher itself, not to anyone's workspace. */
export const SYSTEM_WORKSPACE = "_system";

const store = globalThis as typeof globalThis & { __loopableScope?: AsyncLocalStorage<Scope> };
// One instance per process, even when a dev server loads this module twice.
const scope = (store.__loopableScope ??= new AsyncLocalStorage<Scope>());

export function withWorkspace<T>(workspaceId: string, work: () => T, userId: string | null = null): T {
  return scope.run({ workspaceId, userId }, work);
}

export function currentScope(): Scope | null {
  return scope.getStore() ?? null;
}

export function workspaceId(): string {
  const current = scope.getStore();
  if (current) return current.workspaceId;
  if (!isHosted()) return LOCAL_WORKSPACE;
  throw new Error("Sign in to Loopable first.");
}

/** The signed-in person, when there is one. A local install has nobody signed in. */
export function currentUserId(): string | null {
  return scope.getStore()?.userId ?? null;
}
