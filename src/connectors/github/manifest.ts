import { defineManifest } from "../define.ts";
import type { SettingField } from "../types.ts";

export const GITHUB_SCOPES = ["repo", "notifications"];

const repositories: SettingField = {
  key: "repositories",
  kind: "string_list",
  label: "Repositories",
  help: "owner/name, one per line. Wildcards work: acme/* or */*. Leave empty for every repository you can see.",
  placeholder: "acme/web",
};

const ignoreDrafts: SettingField = {
  key: "ignoreDrafts",
  kind: "boolean",
  label: "Skip draft pull requests",
  default: true,
};

export const githubManifest = defineManifest({
  id: "github",
  name: "GitHub",
  tagline: "Pick up review requests, assigned issues and failing checks.",
  docsUrl: "https://docs.github.com/rest",
  icon: "Github",
  accent: "bg-neutral-900 text-white",
  auth: {
    kind: "oauth_redirect",
    scopes: GITHUB_SCOPES,
    needsAppRegistration: true,
  },
  events: [
    {
      id: "pull_request.review_requested_of_me",
      name: "Review requested",
      summary: "Someone asked you to review a pull request.",
      conditions: [repositories, ignoreDrafts],
    },
    {
      id: "issue.assigned_to_me",
      name: "Issue assigned",
      summary: "An issue was assigned to you.",
      conditions: [repositories],
    },
    {
      id: "pull_request.commented_on_mine",
      name: "Comment on your pull request",
      summary: "Someone replied on a pull request you opened.",
      conditions: [repositories, ignoreDrafts],
    },
    {
      id: "pull_request.check_failed",
      name: "Checks failed",
      summary: "CI failed on a pull request you opened.",
      conditions: [repositories, ignoreDrafts],
    },
  ],
  actions: [
    {
      id: "github.submit_review",
      name: "Submit a review",
      summary: "Post review comments on a pull request after you approve them.",
    },
    {
      id: "github.post_issue_comment",
      name: "Comment on an issue",
      summary: "Post a prepared comment after you approve it.",
    },
  ],
  // Nothing to configure per account: what the account can see is what GitHub
  // decides, and every narrowing choice belongs to a rule.
  settings: [],
  ruleTemplates: [
    {
      id: "review-requested",
      name: "Review pull requests I am asked to review",
      summary: "Drafts a review whenever someone requests yours.",
      eventId: "pull_request.review_requested_of_me",
      actionId: "github.submit_review",
      instruction:
        "Review this pull request. Focus on correctness, security and missing tests. Point at specific lines, and say plainly when something looks fine.",
      conditions: { repositories: [], ignoreDrafts: true },
    },
    {
      id: "issue-assigned",
      name: "Plan issues assigned to me",
      summary: "Drafts a short implementation plan as a comment.",
      eventId: "issue.assigned_to_me",
      actionId: "github.post_issue_comment",
      instruction:
        "Write a short implementation plan for this issue: what to change, in which files, and what to watch out for. Do not write the code.",
      conditions: { repositories: [] },
    },
    {
      id: "comments-on-mine",
      name: "Answer comments on my pull requests",
      summary: "Drafts a reply to review comments you received.",
      eventId: "pull_request.commented_on_mine",
      actionId: "github.post_issue_comment",
      instruction:
        "Read the review comments and draft a reply. Say what you would change and why, and push back politely where the comment is mistaken.",
      conditions: { repositories: [], ignoreDrafts: false },
    },
    {
      id: "ci-failed",
      name: "Explain failing checks on my pull requests",
      summary: "Drafts an explanation of the failure and a suggested fix.",
      eventId: "pull_request.check_failed",
      actionId: "github.post_issue_comment",
      instruction:
        "Work out why the checks failed. Explain the cause in a few sentences and suggest the smallest fix. Quote the part of the log that matters.",
      conditions: { repositories: [], ignoreDrafts: true },
    },
  ],
  // The redirect authorizes whichever account the browser is already signed in
  // as, so a second account is out of reach without signing out of GitHub
  // first. Connections are still rows, so this is a product decision only.
  allowsMultipleAccounts: false,
});
