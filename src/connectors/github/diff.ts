/**
 * A unified patch, read twice: once to write line numbers into it, and once to
 * know which of those numbers a comment may be attached to.
 *
 * The numbers are put in the diff on purpose. An agent can work them out from
 * the @@ headers, and gets them wrong often enough that reviews end up pointing
 * a few lines off, which is worse than useless in a review. Telling it the
 * number costs a few characters per line and removes the arithmetic.
 */

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export type AnnotatedPatch = {
  /** The patch with the line number of the new file written into each line. */
  text: string;
  /** New-file line numbers a comment can be anchored to, in order. */
  lines: number[];
};

/**
 * Only lines that survive into the new file get a number, because those are
 * the only ones a comment on the right-hand side can be attached to. A removed
 * line is shown, and deliberately left unnumbered so it cannot be aimed at.
 */
export function annotate(patch: string): AnnotatedPatch {
  const out: string[] = [];
  const lines: number[] = [];
  let next = 0;

  for (const line of patch.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      out.push(`      | ${line}`);
      continue;
    }
    // "\ No newline at end of file" is a note about the line above it.
    if (next === 0 || line.startsWith("\\")) {
      out.push(`      | ${line}`);
      continue;
    }

    const marker = line[0] ?? " ";
    const content = line.slice(1);
    if (marker === "-") {
      out.push(`-     | ${content}`);
      continue;
    }
    // The marker stays first so the block still reads as a diff.
    out.push(`${marker}${String(next).padStart(5)} | ${content}`);
    lines.push(next);
    next += 1;
  }

  return { text: out.join("\n"), lines };
}

/** Said once at the top of the file, rather than above every patch. */
export const ANNOTATION_LEGEND = [
  "Each line is shown as `<marker><line number> | <content>`, where the number",
  "is the line in the new version of the file. Removed lines have no number.",
].join("\n");
