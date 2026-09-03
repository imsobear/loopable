import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import type { NormalizedEvent } from "../github/map-notification.ts";
import { matchRule, type Rule } from "./rules.ts";

export type RunRow = {
  id: string;
  event_id: string;
  work_item_id: string;
  rule_id: string;
  action_type: string;
  state: string;
  outcome: string | null;
  summary: string | null;
  log_text: string;
  created_at: string;
  updated_at: string;
};

export function ingestEvent(
  db: Db,
  event: NormalizedEvent,
  rules: Rule[],
): { created: boolean; run: RunRow | null } {
  const existing = db.prepare("select id from events where id = ?").get(event.id);
  if (existing) {
    return { created: false, run: null };
  }

  const rule = matchRule(rules, event);
  const now = new Date().toISOString();
  db.prepare(
    `insert into events (id, type, work_item_id, payload_json, received_at)
     values (?, ?, ?, ?, ?)`,
  ).run(event.id, event.type, event.workItemId, JSON.stringify(event), now);

  const repo = event.payload.repository;
  const kind = event.workItemId.includes("/pull/") ? "pull" : "issues";
  db.prepare(
    `insert into work_items (id, repo, kind, state, updated_at)
     values (?, ?, ?, 'open', ?)
     on conflict(id) do update set updated_at = excluded.updated_at`,
  ).run(event.workItemId, repo, kind, now);

  if (!rule) {
    return { created: true, run: null };
  }

  const runId = randomUUID();
  db.prepare(
    `insert into runs (
      id, event_id, work_item_id, rule_id, action_type, state, created_at, updated_at
    ) values (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(runId, event.id, event.workItemId, rule.id, rule.action.type, now, now);

  const run = db.prepare("select * from runs where id = ?").get(runId) as RunRow;
  return { created: true, run };
}
