import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
create table if not exists cursors (
  connector text primary key,
  last_poll_at text,
  last_modified text,
  etag text
);

create table if not exists work_items (
  id text primary key,
  repo text not null,
  kind text not null,
  state text not null default 'open',
  session_handle text,
  worktree_path text,
  updated_at text not null
);

create table if not exists events (
  id text primary key,
  type text not null,
  work_item_id text not null,
  payload_json text not null,
  received_at text not null
);

create table if not exists rules (
  id text primary key,
  enabled integer not null default 1,
  json text not null
);

create table if not exists runs (
  id text primary key,
  event_id text not null,
  work_item_id text not null,
  rule_id text not null,
  action_type text not null,
  state text not null,
  outcome text,
  summary text,
  log_text text not null default '',
  created_at text not null,
  updated_at text not null
);

create table if not exists proposed_ops (
  id integer primary key autoincrement,
  run_id text not null,
  op_json text not null,
  status text not null default 'pending'
);

create table if not exists audit (
  id integer primary key autoincrement,
  run_id text not null,
  action text not null,
  detail_json text not null,
  created_at text not null
);

create table if not exists settings (
  key text primary key,
  value text not null
);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal;");
  db.exec("pragma foreign_keys = on;");
  db.exec(SCHEMA);
  return db;
}
