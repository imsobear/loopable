/**
 * The git a loop needs to write code back.
 *
 * All of it happens in a worktree cut from a repository the person already has
 * on disk, never in that repository's own working tree. A loop that ran in the
 * folder you have open would stage whatever you had half-finished and commit
 * it under a message about something else, and it would do that while you were
 * typing.
 */

import { execFile } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type GitResult = { ok: boolean; stdout: string; stderr: string };

/**
 * Never given the agent's environment, and never written to the run log. Both
 * for the same reason: what goes through here is authorized to push.
 */
function run(
  args: string[],
  options: { cwd: string; askpass?: string; token?: string },
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          // Nothing here may stop and ask. A prompt in a process nobody is
          // watching is a loop that hangs until its timeout.
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: options.askpass ?? "",
          LOOPABLE_GIT_TOKEN: options.token ?? "",
          // A person's own hooks and identity are theirs, and a loop running
          // them unattended is a surprise. The identity is set per commit.
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
async function must(
  args: string[],
  options: { cwd: string; askpass?: string; token?: string },
): Promise<string> {
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

export async function fetchOrigin(repo: string): Promise<void> {
  await must(["fetch", "--quiet", "origin"], { cwd: repo });
}

/**
 * A worktree of `repo` at a new branch, cut from the tip of `base` as the
 * remote has it.
 *
 * A worktree rather than a clone because it shares the object store: cutting
 * one off a large repository takes about as long as writing the files, and a
 * clone of it takes minutes and a copy of its whole history.
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
 * A token reaches git through an askpass program and never through the command
 * line or the remote URL. Both of those end up somewhere they are read back:
 * the URL in `.git/config` and in git's own error messages, the command line
 * in the process list.
 */
function askpassFor(dir: string): string {
  const path = join(dir, "askpass.sh");
  writeFileSync(path, '#!/bin/sh\nprintf %s "$LOOPABLE_GIT_TOKEN"\n');
  chmodSync(path, 0o700);
  return path;
}

/**
 * Push the branch, and refuse to be the reason anything is lost.
 *
 * No force, ever: this runs unattended, and the difference between a wasted
 * run and somebody's afternoon is that flag. A rejected push means somebody
 * else moved it, which is a thing to be told about rather than to win.
 */
export async function pushBranch(input: {
  dir: string;
  url: string;
  branch: string;
  token: string;
}): Promise<void> {
  const askpass = askpassFor(input.dir);
  const result = await run(
    ["push", "--quiet", input.url, `HEAD:refs/heads/${input.branch}`],
    { cwd: input.dir, askpass, token: input.token },
  );
  if (result.ok) return;
  // Whatever git says here can quote the URL, which is the one string that
  // must not reach a log. It is built from the remote and has no secret in it,
  // but that is true only for as long as nobody changes how this is called.
  const said = (result.stderr || result.stdout).replaceAll(input.token, "[token]");
  throw new Error(`Could not push ${input.branch}: ${said}`);
}
