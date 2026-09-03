import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Db } from "../db.ts";
import { getRun, transition, type ProposedOp } from "../engine/runs.ts";
import { defaultRules } from "../engine/default-rules.ts";
import { createGithubClient, getIssue, getPull, listPullFiles } from "../github/client.ts";
import { isLocalOnlyRepo } from "../github/publisher.ts";
import { getGithubAccessToken } from "../credentials.ts";

const MARKER = "\n\nPrepared with local agent.";

function loadRules(db: Db) {
  const rows = db.prepare("select json from rules").all() as Array<{ json: string }>;
  if (rows.length === 0) return defaultRules();
  return rows.map((r) => JSON.parse(r.json));
}

export async function prepareRun(db: Db, runId: string): Promise<void> {
  const run = getRun(db, runId);
  transition(db, runId, "running");
  const event = db
    .prepare("select payload_json from events where id = ?")
    .get(run.event_id) as { payload_json: string };
  const parsed = JSON.parse(event.payload_json) as {
    payload: { repository: string; number: number; title: string };
  };
  const rules = loadRules(db);
  const rule = rules.find((r: { id: string }) => r.id === run.rule_id);
  const instructions = rule?.action?.instructions ?? "";

  const token = await getGithubAccessToken();
  let body = "";
  let files: Array<{ filename: string; patch?: string }> = [];
  let htmlUrl = "";
  if (token && !isLocalOnlyRepo(parsed.payload.repository)) {
    const client = await createGithubClient(token);
    if (run.action_type === "prepare_issue_plan") {
      const issue = await getIssue(client, parsed.payload.repository, parsed.payload.number);
      body = issue.body ?? "";
      htmlUrl = issue.html_url;
    } else {
      const pull = await getPull(client, parsed.payload.repository, parsed.payload.number);
      body = pull.body ?? "";
      htmlUrl = pull.html_url;
      files = await listPullFiles(client, parsed.payload.repository, parsed.payload.number);
    }
  }

  const snapshot = buildSnapshot({
    action: run.action_type,
    title: parsed.payload.title,
    url: htmlUrl,
    body,
    files,
    instructions,
  });
  const dir = join(tmpdir(), "loopable", runId);
  mkdirSync(dir, { recursive: true });
  const promptPath = join(dir, "PROMPT.md");
  writeFileSync(promptPath, snapshot);

  const agentText = await runCodex(dir);
  const draft = (agentText ?? stubDraft(run.action_type, parsed.payload.title, files)).trim() + MARKER;
  const [owner, repo] = parsed.payload.repository.split("/");
  const op: ProposedOp =
    run.action_type === "review_pull_request"
      ? {
          type: "github.submit_review",
          owner,
          repo,
          pull: parsed.payload.number,
          event: "COMMENT",
          body: draft,
        }
      : {
          type: "github.post_issue_comment",
          owner,
          repo,
          issue: parsed.payload.number,
          body: draft,
        };

  transition(db, runId, "needs_approval", { summary: draft.slice(0, 280), proposedOp: op });
}

function buildSnapshot(input: {
  action: string;
  title: string;
  url: string;
  body: string;
  files: Array<{ filename: string; patch?: string }>;
  instructions: string;
}): string {
  const patches = input.files
    .slice(0, 20)
    .map((f) => `### ${f.filename}\n\`\`\`\n${(f.patch ?? "").slice(0, 4000)}\n\`\`\``)
    .join("\n\n");
  return `Action: ${input.action}
Title: ${input.title}
URL: ${input.url}

Instructions:
${input.instructions}

Description:
${input.body}

Changed files:
${patches}

Write the GitHub comment or review body only. Do not include a token. Do not run git push.
`;
}

function stubDraft(
  action: string,
  title: string,
  files: Array<{ filename: string }>,
): string {
  const names = files.map((f) => `- \`${f.filename}\``).join("\n") || "- (files not fetched; no GitHub token)";
  if (action === "review_pull_request") {
    return `## Review: ${title}\n\nLooked at:\n${names}\n\nPlease confirm tests cover the new behavior.`;
  }
  if (action === "prepare_issue_plan") {
    return `## Plan: ${title}\n\n1. Reproduce and write a failing test.\n2. Implement the smallest change.\n3. Verify locally.`;
  }
  return `## Notes: ${title}\n\nPrepared a local draft for this event.`;
}

async function runCodex(cwd: string): Promise<string | null> {
  const bin = process.env.LOOPABLE_RUNNER ?? "codex";
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ["exec", "--skip-git-repo-check", "Read PROMPT.md and reply with only the GitHub review or comment body."],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, 8 * 60 * 1000);
    child.stdout.on("data", (c) => {
      out += String(c);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else resolve(null);
    });
  });
}
