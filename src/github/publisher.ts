import type { GithubClient } from "./client.ts";
import { postIssueComment, submitReview } from "./client.ts";
import type { ProposedOp } from "../engine/runs.ts";

// Fixture data seeded by `loopable demo`. It has no counterpart on GitHub, so it
// is neither hydrated nor published, whether or not a token is present.
export function isLocalOnlyRepo(repo: string): boolean {
  return repo.startsWith("demo/");
}

export function isLocalOnlyOp(op: ProposedOp): boolean {
  return op.owner === "demo";
}

export async function applyOp(
  client: GithubClient | null,
  op: ProposedOp,
): Promise<{ externalId: string }> {
  if (isLocalOnlyOp(op)) {
    return { externalId: "demo-local" };
  }
  if (!client) throw new Error("GitHub token missing");
  if (op.type === "github.submit_review") {
    if (!op.pull) throw new Error("missing pull number");
    const res = await submitReview(client, op.owner, op.repo, op.pull, op.body);
    return { externalId: String(res.id) };
  }
  if (op.type === "github.post_issue_comment") {
    if (!op.issue) throw new Error("missing issue number");
    const res = await postIssueComment(client, op.owner, op.repo, op.issue, op.body);
    return { externalId: String(res.id) };
  }
  throw new Error(`unsupported op`);
}
