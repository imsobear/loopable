import { originUrl, pushBranch } from "#/server/git.ts";
import { defineRuntime } from "../define.ts";
import type { ActionSource, ConnectorAccount } from "../types.ts";
import { oauthAppRegistration } from "../oauth-app.ts";
import {
  createPullRequest,
  getViewer,
  postIssueComment,
  pullForBranch,
  submitReview,
} from "./api.ts";
import { pollGithub } from "./poll.ts";
import { githubRef, parseGithubRef, parseGithubUrl, resolveWorkItem } from "./work-item.ts";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  refreshCredential,
  type GithubCredential,
} from "./oauth.ts";

function requireRegistration() {
  const registration = oauthAppRegistration("github");
  if (!registration) {
    throw new Error("GitHub is not configured in this build: the OAuth app registration is missing.");
  }
  return registration;
}

function accountFrom(user: Awaited<ReturnType<typeof getViewer>>): ConnectorAccount {
  return {
    id: String(user.user.id),
    label: user.user.login,
    url: user.user.html_url,
    avatarUrl: user.user.avatar_url,
    scopes: user.scopes,
  };
}

/**
 * Where the loop was triggered, read as a GitHub ref. Only possible when
 * GitHub is where it came from: another connector's ref is a label this one
 * has no business taking apart, so a loop that crosses services has to say
 * where the answer goes instead of leaving it to be guessed.
 */
function sourceRef(source: ActionSource, what: string): { repo: string; number: number } {
  if (source.connectorId !== "github") {
    throw new Error(`${what} needs a GitHub issue or pull request. Choose one on the loop.`);
  }
  return parseGithubRef(source.ref);
}

function namedRef(url: string): { repo: string; number: number } {
  const parsed = parseGithubUrl(url);
  if (!parsed) throw new Error(`That is not a GitHub issue or pull request: ${url}`);
  return { repo: parsed.repo, number: parsed.number };
}

/**
 * Which repository a clone on disk belongs to.
 *
 * Read from the clone rather than asked of the loop, because the loop already
 * answered it by naming the folder. Anything else would let a change made
 * against one repository be opened on another.
 */
async function repoFromOrigin(repo: string): Promise<string> {
  const url = await originUrl(repo);
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`${repo} does not push to GitHub: its origin is ${url}`);
  return match[1]!;
}

/** The agent was asked for a subject line first, so this is that line. */
function titleOf(body: string): string {
  const first = body.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const clean = first.replace(/^#+\s*/, "");
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean || "Changes from Loopable";
}

/**
 * The description, with the two things the agent cannot say for itself: what
 * this came from, and how big it is. Both are what a person checks first when
 * a pull request appears that they did not open.
 */
function pullBody(input: { body: string; source: ActionSource; stat: string }): string {
  const closes =
    input.source.connectorId === "github" && input.source.kind === "issue"
      ? `Closes #${parseGithubRef(input.source.ref).number}`
      : `From [${input.source.title}](${input.source.url})`;
  const size = input.stat ? `\n\n<details><summary>Files changed</summary>\n\n\`\`\`\n${input.stat}\n\`\`\`\n\n</details>` : "";
  return `${closes}\n\n${input.body}${size}`;
}

/**
 * Returns a usable access token, refreshing it when the stored one has expired.
 * The refreshed credential is handed back so the caller can persist it.
 */
export async function usableToken(
  credential: GithubCredential,
): Promise<{ accessToken: string; refreshed?: GithubCredential }> {
  const stillValid = !credential.expiresAt || Date.now() < credential.expiresAt;
  if (stillValid) return { accessToken: credential.accessToken };
  if (!credential.refreshToken) {
    throw new Error("The GitHub token expired and there is no refresh token. Reconnect the account.");
  }
  const registration = requireRegistration();
  const refreshed = await refreshCredential({
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    refreshToken: credential.refreshToken,
  });
  return { accessToken: refreshed.accessToken, refreshed };
}

export const githubRuntime = defineRuntime({
  async readiness() {
    if (oauthAppRegistration("github")) return { ready: true };
    return {
      ready: false,
      reason: "This build has no GitHub app registration.",
      fixHint:
        "Add config/oauth-app.json, or set LOOPABLE_GITHUB_CLIENT_ID and LOOPABLE_GITHUB_CLIENT_SECRET.",
    };
  },
  identifyLink(url) {
    const parsed = parseGithubUrl(url);
    if (!parsed) return null;
    return { kind: parsed.kind, ref: githubRef(parsed.repo, parsed.number) };
  },

  async resolveWorkItem({ url, credential }) {
    const { accessToken } = await usableToken(credential as GithubCredential);
    return resolveWorkItem(url, accessToken);
  },

  async poll({ workflowId, settings, credential }) {
    const { accessToken } = await usableToken(credential as GithubCredential);
    // No cursor: GitHub is asked what matches now, and the answer is complete
    // every time, so there is no position to keep.
    return { signals: await pollGithub({ workflowId, settings, accessToken }) };
  },

  async applyAction({ actionId, target, source, body, comments, changes, credential }) {
    const { accessToken } = await usableToken(credential as GithubCredential);
    if (actionId === "github.submit_review") {
      const { repo, number } = sourceRef(source, "A review");
      if (source.kind !== "pull_request") {
        throw new Error("A review can only be submitted on a pull request.");
      }
      const review = await submitReview(
        accessToken,
        repo,
        number,
        body,
        (comments ?? []).map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: "RIGHT" as const,
          ...(comment.startLine !== undefined
            ? { start_line: comment.startLine, start_side: "RIGHT" as const }
            : {}),
          body: comment.body,
        })),
      );
      return { url: review.html_url };
    }
    if (actionId === "github.post_issue_comment") {
      const named = typeof target.issue === "string" ? target.issue.trim() : "";
      const { repo, number } = named ? namedRef(named) : sourceRef(source, "A comment");
      const comment = await postIssueComment(accessToken, repo, number, body);
      return { url: comment.html_url };
    }
    if (actionId === "github.open_pull_request") {
      if (!changes) throw new Error("There is no branch to open a pull request for.");
      const repo = await repoFromOrigin(changes.repo);

      await pushBranch({
        dir: changes.dir,
        url: `https://github.com/${repo}.git`,
        branch: changes.branch,
        token: accessToken,
      });

      // The same branch pushed twice is a retry, not a second change. GitHub
      // refuses a duplicate pull request, and the one already open is now
      // updated, which is the answer a person wanted anyway.
      const owner = repo.split("/")[0]!;
      const existing = await pullForBranch(accessToken, repo, owner, changes.branch);
      if (existing) return { url: existing.html_url };

      const opened = await createPullRequest(accessToken, repo, {
        title: titleOf(body),
        body: pullBody({ body, source, stat: changes.stat }),
        head: changes.branch,
        base: changes.base,
      });
      return { url: opened.html_url };
    }
    throw new Error(`GitHub cannot ${actionId}.`);
  },

  auth: {
    async startAuthorization({ redirectUri, state }) {
      const registration = requireRegistration();
      const { verifier, challenge } = createPkce();
      return {
        verifier,
        redirectUrl: buildAuthorizeUrl({
          clientId: registration.clientId,
          redirectUri,
          state,
          challenge,
        }),
      };
    },
    async completeAuthorization({ code, redirectUri, verifier }) {
      const registration = requireRegistration();
      const credential = await exchangeCode({
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
        code,
        redirectUri,
        verifier,
      });
      const viewer = await getViewer(credential.accessToken);
      return { credential, account: accountFrom(viewer) };
    },
    async identity(credential) {
      const { accessToken, refreshed } = await usableToken(credential as GithubCredential);
      const account = accountFrom(await getViewer(accessToken));
      return refreshed ? { account, renewedCredential: refreshed } : { account };
    },
  },
});
