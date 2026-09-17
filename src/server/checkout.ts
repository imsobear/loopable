/**
 * The branch name a code-writing task uses, so a retry pushes the same branch
 * the first attempt made rather than leaving a trail of near-identical ones.
 */

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

export function branchFor(input: { ref: string; taskId: string }): string {
  return `loopable/${slug(input.ref)}-${input.taskId.slice(0, 8)}`;
}
