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

const ignoreBots: SettingField = {
  key: "ignoreBots",
  kind: "boolean",
  label: "Skip pull requests opened by bots",
  help: "Dependabot and friends open a great many, and each one costs a full run.",
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
 * Where the code is. Needed by anything that writes code rather than words:
 * the change is made in a worktree cut from here, and this clone's `origin` is
 * also how the loop knows which repository to open a pull request on.
 */
const folder: SettingField = {
  key: "folder",
  kind: "text",
  label: "Your clone of the repository",
  help: "An absolute path. Work happens in a scratch worktree cut from it, so your own checkout and anything uncommitted in it are left alone.",
  placeholder: "/Users/you/code/web",
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
  help: "A GitHub URL. Leave empty to write back to whatever triggered the loop.",
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

const PLAN_PROMPT = [
  "Write a short implementation plan for this issue.",
  "",
  "Say what should change, in which files where you can tell, and what to watch",
  "out for. Stay inside what the issue actually supports: if it is too vague to",
  "plan, say what is missing rather than inventing the requirements.",
  "",
  "Do not write the implementation.",
].join("\n");

const IMPLEMENT_PROMPT = [
  "Implement this issue in the checkout you are in.",
  "",
  "Read enough of the surrounding code first that what you write looks like it",
  "belongs: the same patterns, the same names, the same way of handling errors.",
  "Where the project has tests for work like this, add one.",
  "",
  "Stay inside what the issue asks for. A change that also tidies three other",
  "things is a change nobody can review. If the issue is too vague to implement,",
  "or doing it properly needs a decision that is not yours to make, reply with",
  "exactly NOTHING_TO_DO rather than guessing: an unwanted pull request costs",
  "more attention than a missing one.",
  "",
  "Run the project's tests if you can work out how, and say in your description",
  "whether you did and what happened.",
].join("\n");

export const githubManifest = defineManifest({
  id: "github",
  name: "GitHub",
  tagline: "Pick up review requests and assigned issues.",
  docsUrl: "https://docs.github.com/rest",
  icon: "Github",
  accent: "bg-neutral-900 text-white",
  auth: {
    kind: "oauth_redirect",
    scopes: GITHUB_SCOPES,
    needsAppRegistration: true,
  },
  workflows: [
    {
      id: "github.review_requested",
      name: "Review pull requests I am asked to review",
      summary: "Reads the change and posts a review whenever someone asks for yours.",
      // Team requests matter more than they sound: in most repositories with a
      // CODEOWNERS file, review arrives addressed to a team rather than a person.
      trigger: "your review is requested, either directly or through a team you belong to",
      // review-requested covers teams; user-review-requested would not.
      watches: "is:open is:pr review-requested:@me",
      writes: "a review on the pull request, as a comment rather than an approval",
      settings: [repositories, ignoreDrafts, ignoreBots, sizeLimit],
      prompt: REVIEW_PROMPT,
      guidancePlaceholder:
        "Anything specific to your team. For example: we require a test for every new endpoint.",
      answer: "review",
      actionId: "github.submit_review",
    },
    {
      id: "github.issue_assigned",
      name: "Plan issues assigned to me",
      summary: "Posts a short implementation plan when an issue lands on you.",
      trigger: "an issue is assigned to you",
      // is:issue matters: without it this would pick up your own pull requests.
      watches: "is:open is:issue assignee:@me",
      writes: "a comment on the issue",
      settings: [repositories],
      prompt: PLAN_PROMPT,
      guidancePlaceholder: "Anything specific to this codebase worth knowing before planning.",
      answer: "text",
      actionId: "github.post_issue_comment",
    },
    {
      id: "github.issue_implement",
      name: "Implement issues assigned to me",
      summary: "Writes the change in a scratch checkout and opens a draft pull request.",
      trigger: "an issue is assigned to you",
      watches: "is:open is:issue assignee:@me",
      writes: "a draft pull request",
      // The only workflow that writes code, and so the only one whose agent
      // gets somewhere to write. Kept apart from "Plan issues assigned to me"
      // rather than replacing it: asking for a plan and asking for the change
      // are different jobs, and which one an issue deserves is a judgement
      // about the issue.
      runsIn: "checkout",
      settings: [repositories, folder],
      prompt: IMPLEMENT_PROMPT,
      guidancePlaceholder:
        "How work is done here. For example: every new endpoint needs a test, and we do not add dependencies without asking.",
      answer: "code",
      actionId: "github.open_pull_request",
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
    {
      id: "github.open_pull_request",
      name: "Open a draft pull request",
      summary: "Push the branch the agent worked on and open a draft pull request for it.",
      // Nothing to ask. The loop already named the clone to work in, and where
      // that clone pushes is where this belongs; a second answer here could
      // only disagree with the first.
      target: [],
      accepts: ["code"],
    },
  ],
  // Nothing to configure per account: what the account can see is what GitHub
  // decides, and every narrowing choice belongs to a loop.
  settings: [],
  // The redirect authorizes whichever account the browser is already signed in
  // as, so a second account is out of reach without signing out of GitHub
  // first. Connections are still rows, so this is a product decision only.
  allowsMultipleAccounts: false,
});
