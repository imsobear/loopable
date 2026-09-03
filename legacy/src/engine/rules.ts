export type ActionType =
  | "prepare_issue_plan"
  | "review_pull_request"
  | "address_review_comments"
  | "investigate_ci_failure";

export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { connector: "github"; event: string };
  filters: {
    repositories: string[];
    ignore_drafts?: boolean;
  };
  action: { type: ActionType; instructions?: string };
  execution: {
    runner: string;
    workspace: "temporary_read_only" | "persistent_worktree" | "repo_read_only";
    timeout: string;
  };
  publishing: {
    mode: "require_approval";
    destination: string;
  };
};

function repoAllowed(pattern: string, repo: string): boolean {
  if (pattern === "*/*") return true;
  const [org, name] = pattern.split("/");
  const [rOrg, rName] = repo.split("/");
  if (org === "*") return rName === name || name === "*";
  if (name === "*") return rOrg === org;
  return pattern === repo;
}

export function matchRule(rules: Rule[], event: { type: string; connector: string; payload: { repository: string; draft?: boolean } }): Rule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.trigger.connector !== event.connector) continue;
    if (rule.trigger.event !== event.type) continue;
    const repos = rule.filters.repositories ?? ["*/*"];
    if (!repos.some((p) => repoAllowed(p, event.payload.repository))) continue;
    if (rule.filters.ignore_drafts && event.payload.draft) continue;
    return rule;
  }
  return null;
}
