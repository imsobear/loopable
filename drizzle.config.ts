import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

const home =
  process.env.LOOPABLE_HOME ??
  join(homedir(), process.env.LOOPABLE_DEV === "1" ? ".loopable-dev" : ".loopable");
const file = process.env.LOOPABLE_DB ?? join(home, "loopable.sqlite");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: file },
});
