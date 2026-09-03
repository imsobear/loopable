import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

const file = process.env.LOOPABLE_DB ?? join(homedir(), ".loopable", "loopable.sqlite");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: file },
});
