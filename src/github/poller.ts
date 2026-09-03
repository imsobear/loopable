import type { Db } from "../db.ts";
import { ingestEvent } from "../engine/ingest.ts";
import { defaultRules } from "../engine/default-rules.ts";
import type { Rule } from "../engine/rules.ts";
import {
  createGithubClient,
  getIssue,
  getPull,
  listNotifications,
  searchIssues,
  type GithubClient,
} from "./client.ts";
import { mapNotification } from "./map-notification.ts";
import { mapSearchWake } from "./search-wake.ts";
import type { NormalizedEvent } from "./map-notification.ts";
import { getGithubAccessToken } from "../credentials.ts";

export async function pollGithub(db: Db, rules: Rule[] = defaultRules()): Promise<{ ingested: number; skipped: number }> {
  const token = await getGithubAccessToken();
  if (!token) {
    return { ingested: 0, skipped: 0 };
  }
  const client = await createGithubClient(token);
  const cursorRow = db
    .prepare("select last_modified from cursors where connector = 'github'")
    .get() as { last_modified: string | null } | undefined;
  const since = cursorRow?.last_modified ?? undefined;
  let events: NormalizedEvent[] = [];
  if (!token.startsWith("ghu_")) {
    try {
      events = await eventsFromNotifications(client, since);
    } catch {
      events = await eventsFromSearch(client, since);
    }
  } else {
    events = await eventsFromSearch(client, since);
  }
  let ingested = 0;
  let skipped = 0;
  for (const mapped of events) {
    const hydrated = await hydrate(client, mapped);
    if (!hydrated) {
      skipped++;
      continue;
    }
    const result = ingestEvent(db, hydrated, rules);
    if (result.created && result.run) ingested++;
    else skipped++;
  }
  const now = new Date().toISOString();
  db.prepare(
    `insert into cursors (connector, last_poll_at, last_modified)
     values ('github', ?, ?)
     on conflict(connector) do update set last_poll_at = excluded.last_poll_at, last_modified = excluded.last_modified`,
  ).run(now, now);
  return { ingested, skipped };
}

async function eventsFromNotifications(client: GithubClient, since?: string): Promise<NormalizedEvent[]> {
  const { items } = await listNotifications(client, since);
  const out: NormalizedEvent[] = [];
  for (const n of items) {
    if (!n.subject.url) continue;
    const mapped = mapNotification(
      {
        id: String(n.id),
        reason: n.reason,
        updated_at: n.updated_at,
        subject: {
          type: n.subject.type,
          title: n.subject.title,
          url: n.subject.url,
          latest_comment_url: n.subject.latest_comment_url,
        },
        repository: n.repository,
      },
      { login: client.login },
    );
    if (mapped) out.push(mapped);
  }
  return out;
}

async function eventsFromSearch(client: GithubClient, since?: string): Promise<NormalizedEvent[]> {
  const login = client.login;
  const review = await searchIssues(client, `review-requested:${login} is:pr is:open archived:false`);
  const assigned = await searchIssues(client, `assignee:${login} is:issue is:open archived:false`);
  const mine = await searchIssues(client, `author:${login} is:pr is:open archived:false`);
  const out: NormalizedEvent[] = [];
  for (const item of review) {
    const mapped = mapSearchWake(item, "review_requested");
    if (mapped) out.push(mapped);
  }
  for (const item of assigned) {
    const mapped = mapSearchWake(item, "assign");
    if (mapped) out.push(mapped);
  }
  for (const item of mine) {
    if (since && item.updated_at <= since) continue;
    const mapped = mapSearchWake(item, "author_comment");
    if (mapped) out.push(mapped);
  }
  return out;
}

async function hydrate(client: GithubClient, event: NormalizedEvent) {
  try {
    if (event.type === "issue.assigned_to_me" && !event.workItemId.includes("/pull/")) {
      const issue = await getIssue(
        client,
        event.payload.repository,
        event.payload.number,
      );
      event.payload.title = issue.title;
      event.payload.url = issue.html_url;
      return event;
    }
    const pull = await getPull(
      client,
      event.payload.repository,
      event.payload.number,
    );
    event.payload.title = pull.title;
    event.payload.draft = pull.draft;
    event.payload.url = pull.html_url;
    if (
      event.type === "check_suite.completed_on_mine" &&
      pull.user.login !== client.login
    ) {
      return null;
    }
    return event;
  } catch {
    return event;
  }
}
