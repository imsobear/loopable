// Applies the database migrations, before a deploy puts out code that needs
// them. The dispatcher still applies them on start, which is then a no-op.
//
//   LOOPABLE_DATABASE_URL=… LOOPABLE_DATABASE_AUTH_TOKEN=… node --experimental-strip-types scripts/migrate.ts
import { migrateIfNeeded } from "#/server/db/client.ts";

if (!process.env.LOOPABLE_DATABASE_URL) {
  console.error("Set LOOPABLE_DATABASE_URL (and LOOPABLE_DATABASE_AUTH_TOKEN) to the database to migrate.");
  process.exit(1);
}
await migrateIfNeeded();
console.log("Migrations applied.");
