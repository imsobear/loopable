/**
 * Against real repositories in a temporary directory, not against a mock. The
 * whole risk in this module is whether the git invocations are right, and a
 * fake that answers the way the code expects would test only the expectation.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWorktree,
  commitAll,
  defaultBranch,
  diffStat,
  hasChanges,
  isRepository,
  originUrl,
  pushBranch,
  removeWorktree,
} from "./git.ts";

let root: string;
let origin: string;
let clone: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    // Captured rather than inherited, so git's asides stay out of the report.
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "loopable-git-"));
  origin = join(root, "origin.git");
  clone = join(root, "clone");

  await mkdir(origin, { recursive: true });
  git(origin, "init", "--bare", "--initial-branch=main", ".");

  git(root, "clone", "--quiet", origin, "clone");
  git(clone, "config", "user.email", "test@localhost");
  git(clone, "config", "user.name", "Test");
  writeFileSync(join(clone, "README.md"), "hello\n");
  git(clone, "add", "-A");
  git(clone, "commit", "--quiet", "-m", "first");
  git(clone, "push", "--quiet", "origin", "main");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("finding the way around a repository", () => {
  it("knows a repository from a directory", async () => {
    expect(await isRepository(clone)).toBe(true);
    expect(await isRepository(root)).toBe(false);
  });

  it("reads the branch to build on even when the clone never recorded one", async () => {
    // A fresh clone has origin/HEAD; deleting it is the older-clone case, and
    // the point of the fallback.
    git(clone, "update-ref", "-d", "refs/remotes/origin/HEAD");
    expect(await defaultBranch(clone)).toBe("main");
  });

  it("is not fooled by whichever branch happens to be checked out", async () => {
    git(clone, "checkout", "--quiet", "-b", "some-side-branch");
    expect(await defaultBranch(clone)).toBe("main");
  });

  it("hands back the remote without any credentials somebody left in it", async () => {
    git(clone, "remote", "set-url", "origin", "https://x-access-token:secret@github.com/a/b.git");
    expect(await originUrl(clone)).toBe("https://github.com/a/b.git");
  });
});

describe("working somewhere else", () => {
  it("leaves the person's own checkout completely alone", async () => {
    // What they were in the middle of, staged and unstaged.
    writeFileSync(join(clone, "mine.txt"), "do not touch\n");
    writeFileSync(join(clone, "README.md"), "edited by me\n");
    const before = git(clone, "status", "--porcelain");

    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    writeFileSync(join(work, "new.txt"), "from the agent\n");
    await commitAll({ dir: work, message: "agent change" });

    expect(git(clone, "status", "--porcelain")).toBe(before);
    expect(readFileSync(join(clone, "README.md"), "utf8")).toBe("edited by me\n");
    // Their branch did not move, and the agent's file is not in their tree.
    expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(clone, "log", "-1", "--format=%s", "main")).toBe("first");
  });

  it("starts from the remote's tip, not from local work", async () => {
    git(clone, "commit", "--quiet", "--allow-empty", "-m", "not pushed");

    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    expect(git(work, "log", "-1", "--format=%s")).toBe("first");
  });

  it("notices what changed, including files that did not exist", async () => {
    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    expect(await hasChanges(work)).toBe(false);

    writeFileSync(join(work, "brand-new.txt"), "hello\n");
    expect(await hasChanges(work)).toBe(true);
  });

  it("commits as Loopable, so a blame trail stays true", async () => {
    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    writeFileSync(join(work, "new.txt"), "x\n");
    const sha = await commitAll({ dir: work, message: "did the thing" });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(work, "log", "-1", "--format=%an")).toBe("Loopable");
    expect(git(work, "log", "-1", "--format=%s")).toBe("did the thing");
  });

  it("does not run the person's hooks", async () => {
    // --absolute-git-dir, not --git-common-dir: the latter answers ".git",
    // relative to the repository, and joining that onto anything resolves
    // against the process's own directory. Which is how an earlier version of
    // this test wrote a failing pre-commit hook into Loopable's own checkout.
    const path = join(git(clone, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
    writeFileSync(path, "#!/bin/sh\nexit 1\n");
    execFileSync("chmod", ["+x", path]);

    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    writeFileSync(join(work, "new.txt"), "x\n");
    await expect(commitAll({ dir: work, message: "past the hook" })).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it("says how much changed", async () => {
    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    writeFileSync(join(work, "new.txt"), "a\nb\n");
    await commitAll({ dir: work, message: "two lines" });

    expect(await diffStat({ dir: work, base: "main" })).toContain("new.txt");
  });

  it("takes its worktree away again", async () => {
    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    expect(git(clone, "worktree", "list")).toContain("work");

    await removeWorktree({ repo: clone, path: work });
    expect(git(clone, "worktree", "list")).not.toContain(join(root, "work"));
  });
});

describe("pushing", () => {
  it("puts the branch on the remote without touching anything else", async () => {
    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    writeFileSync(join(work, "new.txt"), "x\n");
    await commitAll({ dir: work, message: "a change" });

    await pushBranch({ dir: work, branch: "loopable/x" });

    expect(git(origin, "log", "-1", "--format=%s", "loopable/x")).toBe("a change");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("first");
  });

  it("will not force, so somebody else's push cannot be lost", async () => {
    const work = join(root, "work");
    await addWorktree({ repo: clone, path: work, branch: "loopable/x", base: "main" });
    writeFileSync(join(work, "new.txt"), "x\n");
    await commitAll({ dir: work, message: "mine" });
    await pushBranch({ dir: work, branch: "loopable/x" });

    const theirs = join(root, "theirs");
    git(root, "clone", "--quiet", "-b", "loopable/x", origin, "theirs");
    git(theirs, "config", "user.email", "them@localhost");
    git(theirs, "config", "user.name", "Them");
    writeFileSync(join(theirs, "theirs.txt"), "y\n");
    git(theirs, "add", "-A");
    git(theirs, "commit", "--quiet", "-m", "theirs");
    git(theirs, "push", "--quiet", "origin", "loopable/x");

    writeFileSync(join(work, "more.txt"), "z\n");
    await commitAll({ dir: work, message: "mine again" });
    await expect(pushBranch({ dir: work, branch: "loopable/x" })).rejects.toThrow(/Could not push/);

    expect(git(origin, "log", "-1", "--format=%s", "loopable/x")).toBe("theirs");
  });
});
