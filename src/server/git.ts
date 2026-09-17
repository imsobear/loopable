/**
 * Git helpers used in tests. Loopable does not clone or push for the agent;
 * that is in the prompt, and the machine's git does the rest.
 */

import { execFile } from "node:child_process";

export type GitResult = { ok: boolean; stdout: string; stderr: string };

/**
 * Never given the agent's environment. A prompt here would hang a loop until
 * its timeout, so git is told not to ask.
 */
function run(args: string[], options: { cwd: string }): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          HOME: process.env.HOME ?? "",
        },
      },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}

/** Fails with what git said, which is the only useful thing to say about it. */
async function must(args: string[], options: { cwd: string }): Promise<string> {
  const result = await run(args, options);
  if (!result.ok) {
    throw new Error(`git ${args[0]} failed: ${result.stderr || result.stdout || "no output"}`);
  }
  return result.stdout;
}

export async function isRepository(dir: string): Promise<boolean> {
  const result = await run(["rev-parse", "--git-dir"], { cwd: dir });
  return result.ok;
}

/**
 * What the remote calls its main line, as the local clone recorded it.
 *
 * Read from origin/HEAD rather than from whatever is checked out, because the
 * branch someone happens to be on is not the branch a change should be based
 * on. Clones made with older git, or with a since-changed default, have no
 * origin/HEAD, so it is asked for once and then read back.
 */
export async function defaultBranch(repo: string): Promise<string> {
  const head = await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: repo });
  if (head.ok && head.stdout) return head.stdout.replace(/^origin\//, "");

  await run(["remote", "set-head", "origin", "--auto"], { cwd: repo });
  const again = await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: repo });
  if (again.ok && again.stdout) return again.stdout.replace(/^origin\//, "");

  throw new Error("Could not work out which branch this repository builds on.");
}

/** The push URL for `origin`, with any embedded credentials taken back off. */
export async function originUrl(repo: string): Promise<string> {
  const url = await must(["remote", "get-url", "origin"], { cwd: repo });
  return url.replace(/^https:\/\/[^@/]+@/, "https://");
}

/**
 * A worktree of `repo` at a new branch, cut from the tip of `base` as the
 * remote has it.
 */
export async function addWorktree(input: {
  repo: string;
  path: string;
  branch: string;
  base: string;
}): Promise<void> {
  await must(
    ["worktree", "add", "--quiet", "-b", input.branch, input.path, `origin/${input.base}`],
    { cwd: input.repo },
  );
}

/** Best effort, always. A worktree left behind is untidy; throwing here loses a run. */
export async function removeWorktree(input: { repo: string; path: string }): Promise<void> {
  await run(["worktree", "remove", "--force", input.path], { cwd: input.repo });
  await run(["worktree", "prune"], { cwd: input.repo });
}

/** Whether the agent actually changed anything, counting files it created. */
export async function hasChanges(dir: string): Promise<boolean> {
  const status = await must(["status", "--porcelain"], { cwd: dir });
  return status !== "";
}

/**
 * Everything in the worktree, as one commit.
 *
 * Authored as Loopable rather than as the person, because they did not write
 * it and their name on it is what makes a blame trail a lie. `--no-verify`
 * because their hooks are set up for their own work, and a hook that opens an
 * editor or asks a question would hang this.
 */
export async function commitAll(input: { dir: string; message: string }): Promise<string> {
  await must(["add", "--all"], { cwd: input.dir });
  await must(
    [
      "-c",
      "user.name=Loopable",
      "-c",
      "user.email=loopable@localhost",
      "commit",
      "--no-verify",
      "--quiet",
      "--message",
      input.message,
    ],
    { cwd: input.dir },
  );
  return must(["rev-parse", "HEAD"], { cwd: input.dir });
}

/** How much changed, for a person deciding whether to look. */
export async function diffStat(input: { dir: string; base: string }): Promise<string> {
  return must(["diff", "--stat", `origin/${input.base}...HEAD`], { cwd: input.dir });
}

/**
 * Push the branch using the clone's own `origin`. No token: if the machine
 * cannot push, git fails and the task fails.
 *
 * No force, ever: this runs unattended, and the difference between a wasted
 * run and somebody's afternoon is that flag.
 */
export async function pushBranch(input: { dir: string; branch: string }): Promise<void> {
  const result = await run(["push", "--quiet", "origin", `HEAD:refs/heads/${input.branch}`], {
    cwd: input.dir,
  });
  if (result.ok) return;
  const said = (result.stderr || result.stdout).replace(/^https:\/\/[^@/]+@/gm, "https://");
  throw new Error(`Could not push ${input.branch}: ${said}`);
}
