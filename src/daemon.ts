import { openDb } from "./db.ts";
import { dbPath } from "./paths.ts";
import { startServer, drainQueue } from "./server.ts";
import { pollGithub } from "./github/poller.ts";
import { loadRules } from "./engine/default-rules.ts";

const PORT = Number(process.env.LOOPABLE_PORT ?? 8787);
const INTERVAL = Number(process.env.LOOPABLE_POLL_MS ?? 60_000);

export function runDaemon(): void {
  const db = openDb(dbPath());
  const server = startServer(db, PORT);
  console.log(`Loopable http://127.0.0.1:${PORT}`);
  const tick = async () => {
    try {
      await pollGithub(db, loadRules(db));
      await drainQueue(db);
    } catch (err) {
      console.error("poll failed", err);
    }
  };
  tick();
  setInterval(tick, INTERVAL);
  const stop = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
