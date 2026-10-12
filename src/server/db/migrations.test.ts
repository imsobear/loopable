import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const folder = join(process.cwd(), "drizzle");

describe("migrations", () => {
  it("put a breakpoint between statements: a local file runs only the first, and Turso refuses them all", () => {
    for (const file of readdirSync(folder).filter((name) => name.endsWith(".sql"))) {
      const chunks = readFileSync(join(folder, file), "utf8").split("--> statement-breakpoint");
      for (const chunk of chunks) {
        // A statement starts a line with its keyword; semicolons alone would
        // also count the ones inside quoted text.
        const statements = chunk
          .split("\n")
          .filter((line) => /^(CREATE|ALTER|INSERT|DROP|UPDATE|DELETE|PRAGMA)\b/.test(line));
        expect(statements.length, `${file} has two statements in one chunk`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("are all in the journal", () => {
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = new Set(journal.entries.map((entry) => `${entry.tag}.sql`));
    for (const file of readdirSync(folder).filter((name) => name.endsWith(".sql"))) {
      expect(tags.has(file), `${file} is not in the journal`).toBe(true);
    }
  });
});
