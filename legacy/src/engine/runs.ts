import type { Db } from "../db.ts";
import type { RunRow } from "./ingest.ts";

export type ProposedOp = {
  type: "github.submit_review" | "github.post_issue_comment";
  owner: string;
  repo: string;
  pull?: number;
  issue?: number;
  event?: "COMMENT";
  body: string;
  comments?: unknown[];
};

const ALLOWED: Record<string, string[]> = {
  detected: ["queued", "cancelled"],
  queued: ["preparing", "running", "cancelled"],
  preparing: ["running", "failed", "cancelled"],
  running: ["needs_approval", "failed", "cancelled"],
  needs_approval: ["completed", "cancelled"],
  failed: ["queued"],
  completed: [],
  cancelled: ["queued"],
};

export function getRun(db: Db, id: string): RunRow {
  const row = db.prepare("select * from runs where id = ?").get(id) as RunRow | undefined;
  if (!row) throw new Error(`run not found: ${id}`);
  return row;
}

export function transition(
  db: Db,
  runId: string,
  next: string,
  extra?: { summary?: string; proposedOp?: ProposedOp; log?: string },
): RunRow {
  const run = getRun(db, runId);
  const allowed = ALLOWED[run.state] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`cannot go from ${run.state} to ${next}`);
  }
  const now = new Date().toISOString();
  db.prepare(
    `update runs set state = ?, summary = coalesce(?, summary), log_text = log_text || ?, updated_at = ?
     where id = ?`,
  ).run(next, extra?.summary ?? null, extra?.log ?? "", now, runId);

  if (extra?.proposedOp) {
    db.prepare(
      `insert into proposed_ops (run_id, op_json, status) values (?, ?, 'pending')`,
    ).run(runId, JSON.stringify(extra.proposedOp));
  }
  return getRun(db, runId);
}

export function approveRun(
  db: Db,
  runId: string,
  result: { externalId: string },
): RunRow {
  const now = new Date().toISOString();
  const run = getRun(db, runId);
  if (run.state !== "needs_approval") {
    throw new Error(`run ${runId} is not waiting for approval`);
  }
  db.prepare(
    `update proposed_ops set status = 'applied' where run_id = ? and status = 'pending'`,
  ).run(runId);
  db.prepare(
    `insert into audit (run_id, action, detail_json, created_at) values (?, 'publish', ?, ?)`,
  ).run(runId, JSON.stringify(result), now);
  db.prepare(
    `update runs set state = 'completed', outcome = 'published', updated_at = ? where id = ?`,
  ).run(now, runId);
  return getRun(db, runId);
}

export function rejectRun(db: Db, runId: string): RunRow {
  const now = new Date().toISOString();
  const run = getRun(db, runId);
  if (run.state !== "needs_approval") {
    throw new Error(`run ${runId} is not waiting for approval`);
  }
  db.prepare(
    `update proposed_ops set status = 'rejected' where run_id = ? and status = 'pending'`,
  ).run(runId);
  db.prepare(
    `insert into audit (run_id, action, detail_json, created_at) values (?, 'reject', '{}', ?)`,
  ).run(runId, now);
  db.prepare(
    `update runs set state = 'completed', outcome = 'rejected', updated_at = ? where id = ?`,
  ).run(now, runId);
  return getRun(db, runId);
}

export function listInbox(db: Db): Array<RunRow & { title: string; repository: string; event_type: string }> {
  const rows = db
    .prepare(
      `select r.*, json_extract(e.payload_json, '$.payload.title') as title,
              json_extract(e.payload_json, '$.payload.repository') as repository,
              e.type as event_type
       from runs r
       join events e on e.id = r.event_id
       order by r.created_at desc
       limit 100`,
    )
    .all() as Array<RunRow & { title: string; repository: string; event_type: string }>;
  return rows;
}
