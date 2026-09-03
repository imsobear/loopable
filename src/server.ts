import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.ts";
import { listInbox, getRun, approveRun, rejectRun } from "./engine/runs.ts";
import { loadRules } from "./engine/default-rules.ts";
import { pollGithub } from "./github/poller.ts";
import { prepareRun } from "./engine/prepare.ts";
import { createGithubClient } from "./github/client.ts";
import { applyOp } from "./github/publisher.ts";
import {
  clearGithubSession,
  clearPendingOAuth,
  getGithubAccessToken,
  getGithubSession,
  getOAuthApp,
  getPendingOAuth,
  mergeGithubSession,
  setPendingOAuth,
} from "./credentials.ts";
import {
  assertPending,
  beginAuthorize,
  exchangeCode,
  REGISTERED_CALLBACK_URL,
  resultHtml,
} from "./github/oauth.ts";
import type { ProposedOp } from "./engine/runs.ts";

const here = dirname(fileURLToPath(import.meta.url));

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

export function startServer(db: Db, port: number): ReturnType<typeof createServer> {
  loadRules(db);
  const origin = `http://127.0.0.1:${port}`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);
    try {
      if (req.method === "GET" && url.pathname.startsWith("/oauth/github/")) {
        await handleOAuth(res, url, origin);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const page = readFileSync(join(here, "..", "web", "index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const session = getGithubSession();
        const token = await getGithubAccessToken();
        json(res, 200, {
          github: Boolean(token),
          oauthApp: Boolean(getOAuthApp()?.clientId),
          login: session?.login ?? null,
          callbackUrl: REGISTERED_CALLBACK_URL,
          pollEverySec: 60,
          bind: "127.0.0.1",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/inbox") {
        json(res, 200, { runs: listInbox(db) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        json(res, 200, { rules: loadRules(db) });
        return;
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)(\/approve|\/reject)?$/);
      if (req.method === "GET" && runMatch && !runMatch[2]) {
        const run = getRun(db, runMatch[1]);
        const ops = db
          .prepare("select * from proposed_ops where run_id = ?")
          .all(run.id);
        const event = db
          .prepare("select * from events where id = ?")
          .get(run.event_id);
        json(res, 200, { run, ops, event });
        return;
      }
      if (req.method === "POST" && runMatch?.[2] === "/approve") {
        const run = getRun(db, runMatch[1]);
        const row = db
          .prepare("select op_json from proposed_ops where run_id = ? and status = 'pending'")
          .get(run.id) as { op_json: string } | undefined;
        if (!row) {
          json(res, 400, { error: "no pending operation" });
          return;
        }
        const op = JSON.parse(row.op_json) as ProposedOp;
        const token = await getGithubAccessToken();
        const client = token ? await createGithubClient(token) : null;
        const result = await applyOp(client, op);
        json(res, 200, { run: approveRun(db, run.id, result) });
        return;
      }
      if (req.method === "POST" && runMatch?.[2] === "/reject") {
        json(res, 200, { run: rejectRun(db, runMatch[1]) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/poll") {
        const result = await pollGithub(db, loadRules(db));
        await drainQueue(db);
        json(res, 200, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/github/disconnect") {
        clearGithubSession();
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function handleOAuth(res: ServerResponse, url: URL, origin: string): Promise<void> {
  try {
    if (url.pathname === "/oauth/github/start") {
      const started = beginAuthorize(origin, getOAuthApp());
      setPendingOAuth(started.pending);
      redirect(res, started.redirect);
      return;
    }
    if (url.pathname === "/oauth/github/callback") {
      const denied = url.searchParams.get("error");
      if (denied) {
        throw new Error(url.searchParams.get("error_description") || denied);
      }
      const pending = assertPending(getPendingOAuth(), url.searchParams.get("state"));
      const code = url.searchParams.get("code");
      const app = getOAuthApp();
      if (!code || !app?.clientId) throw new Error("GitHub did not return an authorization code");
      const tokens = await exchangeCode({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        code,
        origin: pending.origin,
        verifier: pending.verifier,
      });
      const gh = await createGithubClient(tokens.accessToken);
      mergeGithubSession({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        login: gh.login,
      });
      clearPendingOAuth();
      html(res, 200, resultHtml(origin));
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    clearPendingOAuth();
    html(res, 400, resultHtml(origin, err instanceof Error ? err.message : String(err)));
  }
}

export async function drainQueue(db: Db): Promise<void> {
  const queued = db
    .prepare("select id from runs where state = 'queued' order by created_at")
    .all() as Array<{ id: string }>;
  for (const row of queued) {
    try {
      await prepareRun(db, row.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare(
        "update runs set state = 'failed', summary = ?, updated_at = ? where id = ?",
      ).run(msg, new Date().toISOString(), row.id);
    }
  }
}
