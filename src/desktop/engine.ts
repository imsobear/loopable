import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import { claimSingleInstance, releaseSingleInstance, touchDispatcher } from "#/dispatcher/instance.ts";
import { saveAuthorizedConnection, takeAuthAttempt } from "#/server/connections.ts";
import { migrateIfNeeded } from "#/server/db/client.ts";
import { createPoller } from "#/server/poller.ts";
import { sweepRunDirs } from "#/server/tasks.ts";
import { createWorker } from "#/server/worker.ts";
import { LOCAL_WORKSPACE, withWorkspace } from "#/server/workspace.ts";
import { isRpcName, rpc, setEngineOrigin } from "./api.ts";
import { startLocalRunner } from "./local-runner.ts";

/**
 * The engine of the desktop app: the dispatcher, a runner, and a JSON API on
 * loopback for the native screens, in one Node process the app starts and
 * stops. Everything Loopable does happens here; the app draws it.
 *
 * Only the app knows the token, which it makes up at every launch and hands
 * over in the environment, so no other program on the machine can ask.
 */

const token = process.env.LOOPABLE_DESKTOP_TOKEN ?? "";

function log(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

/** Said on stdout as JSON lines, which the app reads. Nothing else goes there. */
function tell(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body ?? null));
}

function html(response: ServerResponse, status: number, title: string, text: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font-family:system-ui;margin:48px;color:#222"><h2>${title}</h2><p>${text}</p>` +
      `<p>You can close this window and go back to Loopable.</p></body>`,
  );
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Where the browser comes back after a connector's authorization. The attempt
 * says which connector and workspace; the state is the only proof needed.
 */
async function oauthCallback(connectorId: string, url: URL, response: ServerResponse): Promise<void> {
  const denied = url.searchParams.get("error");
  if (denied) {
    html(response, 400, "Not connected", escape(url.searchParams.get("error_description") ?? denied));
    return;
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    html(response, 400, "Not connected", "No authorization code came back.");
    return;
  }
  try {
    const attempt = await takeAuthAttempt(state);
    if (attempt.connectorId !== connectorId) {
      throw new Error("This authorization belongs to a different connector.");
    }
    const runtime = connectorRuntime(attempt.connectorId);
    if (!runtime.auth.completeAuthorization) {
      throw new Error("This connector cannot complete a browser authorization.");
    }
    const result = await runtime.auth.completeAuthorization({
      code,
      redirectUri: attempt.redirectUri,
      verifier: attempt.verifier,
    });
    const connection = await withWorkspace(attempt.workspaceId, () =>
      saveAuthorizedConnection(attempt.connectorId, result),
    );
    html(response, 200, "Connected", `Connected as ${escape(connection.accountLabel)}.`);
  } catch (error) {
    html(response, 400, "Not connected", escape(error instanceof Error ? error.message : String(error)));
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://engine");
  const path = url.pathname;

  if (path === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  const callback = /^\/oauth\/([^/]+)\/callback$/.exec(path);
  if (callback && request.method === "GET") {
    await oauthCallback(decodeURIComponent(callback[1]!), url, response);
    return;
  }

  const call = /^\/rpc\/([A-Za-z]+)$/.exec(path);
  if (call && request.method === "POST") {
    if ((request.headers.authorization ?? "") !== `Bearer ${token}`) {
      json(response, 401, { error: "This engine is not open to you." });
      return;
    }
    const name = call[1]!;
    if (!isRpcName(name)) {
      json(response, 404, { error: `Unknown call: ${name}` });
      return;
    }
    let data: unknown = null;
    try {
      const body = await readBody(request);
      data = body ? JSON.parse(body) : null;
    } catch {
      json(response, 400, { error: "The request body is not JSON." });
      return;
    }
    try {
      const handler = rpc[name] as (data: unknown) => Promise<unknown>;
      const result = await withWorkspace(LOCAL_WORKSPACE, () => handler(data));
      json(response, 200, result);
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  response.writeHead(404);
  response.end();
}

async function main(): Promise<void> {
  if (!token) {
    log("LOOPABLE_DESKTOP_TOKEN is not set. The engine is started by the Loopable app.");
    process.exit(2);
  }
  await migrateIfNeeded();
  const claim = await claimSingleInstance();
  if (!claim.ok) {
    tell({ event: "busy", owner: claim.owner });
    log(`another Loopable dispatcher is already running (${claim.owner}).`);
    process.exit(3);
  }

  const swept = sweepRunDirs();
  if (swept > 0) log(`cleared ${swept} old run director${swept === 1 ? "y" : "ies"}`);

  const queue = createWorker({ log });
  const poller = createPoller({ log });
  const beat = setInterval(() => {
    void touchDispatcher().catch((error: unknown) => {
      log(`lease renew failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 5_000);

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) json(response, 500, { error: "The engine hit an error." });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  setEngineOrigin(`http://127.0.0.1:${port}`);

  queue.start();
  poller.start();
  const runner = withWorkspace(LOCAL_WORKSPACE, () => startLocalRunner({ log }));
  log(`engine started (pid ${process.pid}), listening on ${port}`);
  tell({ event: "listening", port, pid: process.pid });

  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${reason}: stopping`);
    clearInterval(beat);
    poller.stop();
    server.close();
    await Promise.all([queue.stop(), runner.stop()]);
    await releaseSingleInstance();
    log("stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // The app holds stdin open. When it is gone, so is the reason to run.
  process.stdin.on("end", () => void shutdown("the app closed"));
  process.stdin.on("error", () => void shutdown("the app closed"));
  process.stdin.resume();
}

await main();
