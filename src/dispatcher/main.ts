import { createServer } from "node:http";
import { createPoller } from "#/server/poller.ts";
import { migrateIfNeeded } from "#/server/db/client.ts";
import { sweepRunDirs } from "#/server/tasks.ts";
import { createWorker } from "#/server/worker.ts";
import { claimSingleInstance, releaseSingleInstance, touchDispatcher } from "./instance.ts";

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function listen(port: number): void {
  createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://dispatcher").pathname;
    if (path === "/health" || path === "/") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    response.writeHead(404);
    response.end();
  }).listen(port, () => {
    log(`dispatcher listening on ${port}`);
  });
}

/**
 * The dispatcher. Polls connectors, prepares tasks, writes results back.
 * Agents always run on a Runner started separately.
 */
async function main(): Promise<void> {
  await migrateIfNeeded();
  const claim = await claimSingleInstance();
  if (!claim.ok) {
    log(`another Loopable dispatcher is already running (${claim.owner}). Nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const swept = sweepRunDirs();
  if (swept > 0) log(`cleared ${swept} old run director${swept === 1 ? "y" : "ies"}`);

  const queue = createWorker({ log });
  const poller = createPoller({ log });
  const port = Number(
    process.env.PORT ?? process.env.LOOPABLE_DISPATCHER_PORT ?? process.env.LOOPABLE_ENGINE_PORT ?? 0,
  );
  if (Number.isFinite(port) && port > 0) listen(port);

  const beat = setInterval(() => {
    void touchDispatcher().catch((error: unknown) => {
      log(`lease renew failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 5_000);

  log(`dispatcher started (pid ${process.pid})`);
  queue.start();
  poller.start();
  log(`watching for signals every ${Math.round(poller.intervalMs / 1000)}s`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal}: stopping`);
    clearInterval(beat);
    poller.stop();
    await queue.stop();
    await releaseSingleInstance();
    log("stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
