import { defineManifest } from "../define.ts";

export const GITHUB_SCOPES = ["repo", "notifications"];

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
    },
    {
      id: "issue.assigned_to_me",
      name: "Issue assigned",
      summary: "An issue was assigned to you.",
    },
    {
      id: "pull_request.commented_on_mine",
      name: "Comment on your pull request",
      summary: "Someone replied on a pull request you opened.",
    },
    {
      id: "pull_request.check_failed",
      name: "Checks failed",
      summary: "CI failed on a pull request you opened.",
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
  settings: [
    {
      key: "repositories",
      kind: "string_list",
      label: "Repositories to watch",
      help: "owner/name, one per line. Leave empty to watch everything you have access to.",
      placeholder: "acme/web",
    },
    {
      key: "ignoreDrafts",
      kind: "boolean",
      label: "Ignore draft pull requests",
      default: true,
    },
  ],
  // The redirect authorizes whichever account the browser is already signed in
  // as, so a second account is out of reach without signing out of GitHub
  // first. Connections are still rows, so this is a product decision only.
  allowsMultipleAccounts: false,
});
