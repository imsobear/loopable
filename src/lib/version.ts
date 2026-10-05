import pkg from "../../package.json" with { type: "json" };

/** This build's version, as published to npm. */
export const VERSION: string = pkg.version;

/**
 * What a runner understands about a job, as a number that only goes up.
 *
 * The package version says which build a runner is; this says whether it can
 * take a given job, which is the question that matters when the App and a
 * runner on another machine were upgraded on different days. Raise it when a
 * job needs a runner to do something an older one would get wrong, and say
 * what in the list below.
 *
 * 1. Up to 0.2.x, which did not report a protocol at all.
 * 2. A folder is relative to the runner's home, and the prompt names context
 *    files by a placeholder the runner fills in with its own workspace.
 */
export const RUNNER_PROTOCOL = 2;

/** What a runner that says nothing is assumed to speak. */
export const LEGACY_RUNNER_PROTOCOL = 1;

/** The lowest protocol a folder job can go to. */
export const FOLDER_JOB_PROTOCOL = 2;

/** Whether `a` is an older x.y.z than `b`. Anything unreadable counts as older. */
export function olderThan(a: string | null, b: string): boolean {
  if (!a) return true;
  const pa = a.split(".").map((part) => Number.parseInt(part, 10));
  const pb = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x)) return true;
    if (x !== y) return x < y;
  }
  return false;
}
