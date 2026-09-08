import { createPoller } from "#/server/poller.ts";
import { sweepRunDirs } from "#/server/tasks.ts";
import { createWorker } from "#/server/worker.ts";
import { beat, claimSingleInstance, HEARTBEAT_MS, releaseSingleInstance } from "./instance.ts";

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

/**
 * The engine. Runs as its own process so a rule keeps working when nobody has
 * the app open, which is the whole point of a loop that runs by itself.
 *
 * It talks to the app only through SQLite: the app queues tasks and asks for
 * them to stop, the daemon does the work and records what happened. No ports,
 * no sockets, nothing to authenticate between the two.
 */
async function main(): Promise<void> {
  const claim = claimSingleInstance();
  if (!claim.ok) {
    log(`another Loopable daemon is already running (pid ${claim.pid}). Nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const swept = sweepRunDirs();
  if (swept > 0) log(`cleared ${swept} old run director${swept === 1 ? "y" : "ies"}`);

  // Saying so on a timer is what makes the claim mean something: the app can
  // tell a running daemon from one that was killed without a word.
  const heartbeat = setInterval(beat, HEARTBEAT_MS);
  heartbeat.unref();

  const worker = createWorker({ log });
  const poller = createPoller({ log });
  log(`daemon started (pid ${process.pid})`);
  worker.start();
  poller.start();
  log(`watching for signals every ${Math.round(poller.intervalMs / 1000)}s`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal}: stopping`);
    clearInterval(heartbeat);
    poller.stop();
    await worker.stop();
    releaseSingleInstance();
    log("stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
