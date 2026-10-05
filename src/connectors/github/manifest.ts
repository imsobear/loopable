import { defineManifest } from "../define.ts";
import type { SettingField } from "../types.ts";

export const GITHUB_SCOPES = ["repo", "notifications"];

const repositories: SettingField = {
  key: "repositories",
  kind: "string_list",
  label: "Repositories",
  help: "owner/name, one per line. acme/* works. Empty means all.",
  placeholder: "acme/web",
};

const ignoreDrafts: SettingField = {
  key: "ignoreDrafts",
  kind: "boolean",
  label: "Skip draft pull requests",
  default: true,
};

const ignoreBots: SettingField = {
  key: "ignoreBots",
  kind: "boolean",
  label: "Skip pull requests opened by bots",
  help: "Such as Dependabot.",
  default: true,
};

/**
 * Not a quality setting so much as a cost one: the largest pull requests give
 * the shallowest reviews and take the longest to produce them.
 */
const sizeLimit: SettingField = {
  key: "maxChangedFiles",
  kind: "select",
  label: "Skip very large pull requests",
  options: [
    { value: "0", label: "Never skip" },
    { value: "25", label: "More than 25 files changed" },
    { value: "50", label: "More than 50 files changed" },
    { value: "100", label: "More than 100 files changed" },
  ],
  default: "50",
};

/**
 * Left empty by every loop that answers what it read, which is most of them.
 * Filled in when the trigger is somewhere else entirely and there is no issue
 * in it to comment on.
 */
const issueTarget: SettingField = {
  key: "issue",
  kind: "text",
  label: "Issue or pull request",
  help: "Empty replies where it was asked. Or a GitHub issue URL.",
  placeholder: "https://github.com/acme/web/issues/12",
};

/**
 * Written once, here, rather than left to whoever creates the loop. A review
 * is a well-understood job and the connector should be good at it by default.
 */
const REVIEW_PROMPT = [
  "Review this pull request the way an experienced engineer on this team would.",
  "",
  "Look for correctness bugs, security problems, races, unhandled errors, and",
  "changes that quietly break existing behaviour. Check whether the change is",
  "tested, and say plainly when it is not.",
  "",
  "Point at specific files and lines rather than describing the change back to",
  "its author. Say when something is done well; a review that lists only faults",
  "reads as hostile. Skip anything a linter or formatter already enforces, and",
  "do not restate what the diff obviously does.",
  "",
  "Where you cannot see enough of the code to judge something, say so instead of",
  "guessing.",
].join("\n");

const REPLY_PROMPT = [
  "Answer this issue in a comment, the way a teammate who knows this codebase would.",
  "",
  "Work out what the issue is asking for. If it is a question, answer it from the",
  "code rather than from memory. If it reports a bug, find the likely cause and",
  "point at the files and lines involved. If it asks for a change, say how you",
  "would make it, where, and what to watch out for.",
  "",
  "Read the code; do not change it. If the issue is too vague to answer, say what",
  "is missing rather than inventing it.",
].join("\n");

export const githubManifest = defineManifest({
  id: "github",
  name: "GitHub",
  tagline: "Pick up reviews and issues sent to your team's shared GitHub account.",
  docsUrl: "https://docs.github.com/rest",
  icon: "Github",
  accent: "bg-neutral-900 text-white",
  auth: {
    kind: "oauth_redirect",
    scopes: GITHUB_SCOPES,
    needsAppRegistration: true,
    // The Connection is the team's agent on GitHub: whatever it writes appears
    // under its name, and the work it picks up is whatever the team sends to
    // it. An account made for this is cleanest, but a teammate's own works too
    // if they are happy for it to be shared.
    note: "Connect the account the team will send work to. An account made for this is cleanest, but your own works too if you are happy to share it. Reviews and comments appear under its name, and it sees only the repositories it can access. Sign in to GitHub as that account first; GitHub authorizes whichever account the browser is signed in as.",
  },
  triggers: [
    {
      id: "github.review_requested",
      when: "A GitHub review is requested",
      // Team requests matter more than they sound: in most repositories with a
      // CODEOWNERS file, review arrives addressed to a team rather than a person.
      trigger: "someone requests a review from the connected account, directly or through its team",
      // review-requested covers teams; user-review-requested would not.
      watches: "is:open is:pr review-requested:@me",
      settings: [repositories, ignoreDrafts, ignoreBots, sizeLimit],
      runsIn: "checkout",
      answer: "review",
      actionId: "github.submit_review",
    },
    {
      id: "github.issue_assigned",
      when: "A GitHub issue is assigned",
      trigger: "an issue is assigned to the connected account",
      // is:issue matters: without it this would pick up pull requests too.
      watches: "is:open is:issue assignee:@me",
      settings: [repositories],
      runsIn: "checkout",
      answer: "text",
      actionId: "github.post_issue_comment",
    },
  ],
  workflows: [
    {
      id: "github.review_requested",
      name: "Review pull requests",
      summary: "Posts a review when someone requests one from the connected account.",
      triggerId: "github.review_requested",
      prompt: REVIEW_PROMPT,
      guidancePlaceholder:
        "Anything specific to your team. For example: we require a test for every new endpoint.",
    },
    {
      // The id is the one "Plan issues assigned to me" had. Planning was one
      // kind of answer to an issue; replying covers it and the rest, and loops
      // made for planning keep the prompt they copied.
      id: "github.issue_assigned",
      name: "Reply to issues",
      summary: "Answers an issue in a comment when it is assigned to the connected account.",
      triggerId: "github.issue_assigned",
      prompt: REPLY_PROMPT,
      guidancePlaceholder:
        "Anything specific to this codebase worth knowing before answering. For example: questions about billing should point at docs/billing.md.",
    },
  ],
  actions: [
    {
      id: "github.submit_review",
      name: "Submit a review",
      summary: "Post a review on a pull request, as a comment rather than an approval.",
      // Nothing to configure, and nothing that could be: a review is anchored
      // to the lines of one diff, so it can only go on the pull request the
      // loop read. Reviewing something a loop was not triggered by would mean
      // reviewing the same change every time it ran.
      target: [],
      accepts: ["text", "review"],
    },
    {
      id: "github.post_issue_comment",
      name: "Comment on an issue",
      summary: "Post a comment on an issue or pull request.",
      target: [issueTarget],
      // A comment is one body of markdown with nowhere to attach anything, so
      // a review arrives here with its findings written into the prose.
      accepts: ["text"],
    },
  ],
  // Nothing to configure per account: what the account can see is what GitHub
  // decides, and every narrowing choice belongs to a loop.
  settings: [],
  // One shared account per team. The redirect also authorizes whichever account
  // the browser is already signed in as, so a second one is out of reach
  // without signing out of GitHub first. Connections are still rows, so this
  // is a product decision only.
  allowsMultipleAccounts: false,
  byHand: { kind: "link", placeholder: "https://github.com/acme/web/pull/123" },
});
