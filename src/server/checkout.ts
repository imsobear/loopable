/**
 * The worktree a code-writing loop works in.
 *
 * It lives inside the run directory, next to the log and the context files, so
 * that everything one run produced is in one place a person can open. It also
 * means a retry finds the work still there: the expensive half of this is the
 * agent, and a push that failed because somebody else moved the branch should
 * not buy the agent's time again.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Changes } from "#/connectors/types.ts";
import {
  addWorktree,
  defaultBranch,
  diffStat,
  fetchOrigin,
  isRepository,
  removeWorktree,
} from "./git.ts";

/** Reads as a branch name and cannot collide with a person's own. */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "work"
  );
}

/**
 * The same name every time this task is tried, so a second attempt pushes the
 * branch the first one made rather than leaving a trail of near-identical ones.
 */
export function branchFor(input: { ref: string; taskId: string }): string {
  return `loopable/${slug(input.ref)}-${input.taskId.slice(0, 8)}`;
}

export type Checkout = Changes & { existed: boolean };

/**
 * A worktree at a new branch off the tip of the default branch, or the one
 * already there from a previous attempt.
 */
export async function openCheckout(input: {
  repo: string;
  runDir: string;
  ref: string;
  taskId: string;
}): Promise<Checkout> {
  if (!(await isRepository(input.repo))) {
    throw new Error(`${input.repo} is not a git repository, so there is nowhere to do the work.`);
  }

  const dir = join(input.runDir, "checkout");
  const branch = branchFor({ ref: input.ref, taskId: input.taskId });
  const base = await defaultBranch(input.repo);

  if (existsSync(dir)) {
    return { dir, branch, base, repo: input.repo, stat: "", existed: true };
  }

  // Fetched first, because the point of basing on origin is to start from what
  // is actually there. A clone somebody has not pulled in a fortnight would
  // otherwise produce a change against a fortnight-old tree.
  await fetchOrigin(input.repo);
  await addWorktree({ repo: input.repo, path: dir, branch, base });
  return { dir, branch, base, repo: input.repo, stat: "", existed: false };
}

export async function measure(checkout: Checkout): Promise<string> {
  return diffStat({ dir: checkout.dir, base: checkout.base });
}

/**
 * Only once the work has landed somewhere. A worktree kept after a failure is
 * what a retry uses, and what someone reads when they want to know what the
 * agent actually did.
 */
export async function closeCheckout(checkout: Checkout): Promise<void> {
  await removeWorktree({ repo: checkout.repo, path: checkout.dir });
}
