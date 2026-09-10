import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSource } from "#/connectors/types.ts";
import type { ConnectionSettings } from "#/lib/domain.ts";

const home = mkdtempSync(join(tmpdir(), "loopable-tasks-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");

/** Every write any connector was asked to make, in order. */
type Write = {
  connectorId: string;
  actionId: string;
  target: Record<string, unknown>;
  source: ActionSource;
  body: string;
  comments: unknown[];
  changes?: { dir: string; branch: string; base: string; repo: string; stat: string };
  credential: unknown;
};
const writes: Write[] = [];

/** What the agent will say, and what it was asked. Set per test. */
let said = "";
let asked = "";
/** Where it was run, and what it does there. Set by the tests that care. */
let ranIn = "";
let agentDoes: ((cwd: string) => void) | null = null;
/** Makes the write fail, for the tests about what survives one. */
let failWrite: string | null = null;

// Two connectors, told apart by which one is asked, because the whole point
// here is that reading and writing need not be the same one.
vi.mock("#/connectors/runtimes.ts", () => ({
  connectorRuntime: (id: string) => ({
    identifyLink: () => ({ kind: "pull_request", ref: "acme/web#7" }),
    resolveWorkItem: async () => ({
      kind: "pull_request",
      ref: "acme/web#7",
      title: "Cache the manifest",
      url: "https://github.com/acme/web/pull/7",
      carry: { secret: `${id} only` },
      commentable: { "src/a.ts": [4] },
      context: [{ name: "CHANGES.md", body: "the diff" }],
    }),
    applyAction: async (input: Omit<Write, "connectorId">) => {
      writes.push({ connectorId: id, ...input, comments: input.comments ?? [] });
      if (failWrite) throw new Error(failWrite);
      return { url: `https://${id}.test/written` };
    },
  }),
}));

vi.mock("./connections.ts", () => ({
  credentialForConnector: async (id: string) => ({ credential: `credential for ${id}` }),
}));

vi.mock("#/agents/runtimes.ts", () => ({
  agentRuntime: () => ({
    run: async (input: { prompt: string; cwd: string }) => {
      asked = input.prompt;
      ranIn = input.cwd;
      agentDoes?.(input.cwd);
      return { ok: true, output: said, durationMs: 1, command: "fake-agent" };
    },
  }),
}));

vi.mock("./agents.ts", () => ({
  listAgents: async () => [{ agentId: "cursor-agent", isDefault: true, installed: true }],
  settingsFor: () => ({ permissionMode: "read_only", model: null, timeoutMs: 1_000 }),
}));

const { db } = await import("./db/client.ts");
const { loops, tasks } = await import("./db/schema.ts");
const { enqueueTask, runTask } = await import("./tasks.ts");

const LOOP_ID = "loop-under-test";

/** Nothing like the workflow's own words, so the two cannot be confused. */
const PROMPT = "Only say whether the lockfile changed.";

/** A loop that watches GitHub, with where it writes left to the caller. */
function givenLoop(action: {
  actionConnectorId: string;
  actionId: string;
  actionTarget?: ConnectionSettings;
}): void {
  db()
    .insert(loops)
    .values({
      id: LOOP_ID,
      name: "Test loop",
      priority: 1,
      connectorId: "github",
      workflowId: "github.review_requested",
      prompt: PROMPT,
      actionTarget: {},
      ...action,
    })
    .run();
}

beforeEach(() => {
  db().delete(tasks).run();
  db().delete(loops).run();
  writes.length = 0;
  said = "";
  asked = "";
  ranIn = "";
  agentDoes = null;
  failWrite = null;
});

describe("what the agent is asked", () => {
  it("is the loop's own words, not the words its workflow still has", async () => {
    // The point of copying the prompt onto the loop: once someone has changed
    // it, the template is history and must not creep back in.
    givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";

    const queued = enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    await runTask(queued.id);

    expect(asked).toContain(PROMPT);
    expect(asked).not.toContain("the way an experienced engineer on this team would");
  });
});

describe("runTask", () => {
  it("writes with the connector that read it, when they are the same", async () => {
    givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = JSON.stringify({
      summary: "Looks right.",
      findings: [{ path: "src/a.ts", line: 4, body: "Name this." }],
    });

    const queued = enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    const done = await runTask(queued.id);

    expect(writes).toHaveLength(1);
    const write = writes[0]!;
    expect(write.connectorId).toBe("github");
    expect(write.credential).toBe("credential for github");
    // The finding sits on a line the diff has, so it is anchored rather than
    // written into the prose.
    expect(write.comments).toEqual([{ path: "src/a.ts", line: 4, body: "Name this." }]);
    expect(write.body).toContain("Looks right.");
    expect(done.state).toBe("done");
  });

  /**
   * A task is retried, so a run that finally works follows one that did not.
   * Leaving the old reason on the row makes the log say a thing was done and,
   * beside it, why it could not be.
   */
  it("clears what an earlier attempt failed with once it works", async () => {
    givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";

    const queued = enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    db()
      .update(tasks)
      .set({ error: "GitHub answered 500", attempts: 1 })
      .where(eq(tasks.id, queued.id))
      .run();

    const done = await runTask(queued.id);

    expect(done.state).toBe("done");
    expect(done.error).toBeNull();
  });

  it("writes with the connector the loop chose, on its own account", async () => {
    // Asked for a review on GitHub, answered in a chat: the case a loop with
    // one connector could not express at all.
    givenLoop({
      actionConnectorId: "wechat",
      actionId: "wechat.reply",
      actionTarget: { to: "me" },
    });
    said = JSON.stringify({
      summary: "Two things to fix.",
      findings: [{ path: "src/a.ts", line: 4, body: "Name this." }],
    });

    const queued = enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    const done = await runTask(queued.id);

    const write = writes[0]!;
    expect(write.connectorId).toBe("wechat");
    expect(write.credential).toBe("credential for wechat");
    expect(write.target).toEqual({ to: "me" });
    // It still learns what the work was, and where the work came from.
    expect(write.source).toMatchObject({
      connectorId: "github",
      ref: "acme/web#7",
      title: "Cache the manifest",
    });
    // A chat has no lines to attach to, so the point is written into the body
    // with its location rather than lost.
    expect(write.comments).toEqual([]);
    expect(write.body).toContain("src/a.ts:4");
    expect(write.body).toContain("Name this.");
    expect(done.resultUrl).toBe("https://wechat.test/written");
  });

  it("keeps one connector's private record of a conversation to itself", async () => {
    // `carry` is whatever the reading connector needs to answer and nobody
    // else can make sense of. Handed across, it would read as a conversation
    // the writer never had.
    givenLoop({ actionConnectorId: "wechat", actionId: "wechat.reply" });
    said = "Nothing to worry about.";

    const queued = enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    await runTask(queued.id);

    expect(writes[0]!.source.carry).toBeUndefined();
  });

  it("stays with what it was queued with after the loop is pointed elsewhere", async () => {
    givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";
    const queued = enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });

    db()
      .update(loops)
      .set({ actionConnectorId: "wechat", actionId: "wechat.reply" })
      .run();
    await runTask(queued.id);

    expect(writes[0]!.connectorId).toBe("github");
  });
});

describe("a loop that writes code", () => {
  let root: string;
  let clone: string;

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  /** The loop names a clone; the work happens in a worktree cut from it. */
  function givenCodeLoop(): void {
    db()
      .insert(loops)
      .values({
        id: LOOP_ID,
        name: "Implement things",
        priority: 1,
        connectorId: "github",
        workflowId: "github.issue_implement",
        prompt: PROMPT,
        settings: { folder: clone },
        actionConnectorId: "github",
        actionId: "github.open_pull_request",
        actionTarget: {},
      })
      .run();
  }

  function queue() {
    return enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/issues/7",
      dryRun: false,
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loopable-code-"));
    const origin = join(root, "origin.git");
    clone = join(root, "clone");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--bare", "--initial-branch=main", ".");
    git(root, "clone", "--quiet", origin, "clone");
    git(clone, "config", "user.email", "t@localhost");
    git(clone, "config", "user.name", "T");
    writeFileSync(join(clone, "README.md"), "hello\n");
    git(clone, "add", "-A");
    git(clone, "commit", "--quiet", "-m", "first");
    git(clone, "push", "--quiet", "origin", "main");
    givenCodeLoop();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("hands the action a branch with the work committed on it", async () => {
    agentDoes = (cwd) => writeFileSync(join(cwd, "feature.ts"), "export const x = 1;\n");
    said = "Add the feature\n\nIt does the thing.";

    const done = await runTask(queue().id);

    expect(done.state).toBe("done");
    const changes = writes[0]!.changes!;
    expect(changes.branch).toMatch(/^loopable\//);
    expect(changes.base).toBe("main");
    expect(changes.stat).toContain("feature.ts");

    // Read from the clone rather than the worktree, which is taken away once
    // the work has landed. Removing a worktree leaves its branch behind, and
    // the branch is what was handed over.
    expect(git(clone, "log", "-1", "--format=%s", changes.branch)).toBe("Add the feature");
    expect(git(clone, "show", "--name-only", "--format=", changes.branch)).toBe("feature.ts");
    // Built on the remote's tip, so it merges back cleanly.
    expect(git(clone, "log", "-1", "--format=%s", `${changes.branch}~1`)).toBe("first");
  });

  it("runs the agent in the worktree and not in the person's own checkout", async () => {
    agentDoes = (cwd) => writeFileSync(join(cwd, "feature.ts"), "x\n");
    said = "Add the feature";

    await runTask(queue().id);

    expect(ranIn).not.toBe(clone);
    // The thing this whole arrangement exists to protect.
    expect(git(clone, "status", "--porcelain")).toBe("");
    expect(existsSync(join(clone, "feature.ts"))).toBe(false);
    expect(git(clone, "log", "-1", "--format=%s")).toBe("first");
  });

  it("says nothing changed rather than sending an empty pull request", async () => {
    // The ordinary way this goes wrong: an agent describes work it did not do.
    agentDoes = null;
    said = "Add the feature\n\nI have made the change.";

    const done = await runTask(queue().id);

    expect(done.state).toBe("skipped");
    expect(done.output).toContain("Nothing was changed");
    expect(writes).toHaveLength(0);
  });

  it("takes the worktree away once the work has landed", async () => {
    agentDoes = (cwd) => writeFileSync(join(cwd, "feature.ts"), "x\n");
    said = "Add the feature";

    await runTask(queue().id);

    expect(existsSync(writes[0]!.changes!.dir)).toBe(false);
    expect(git(clone, "worktree", "list").split("\n")).toHaveLength(1);
  });

  it("keeps the worktree when the write failed, so a retry need not run the agent again", async () => {
    agentDoes = (cwd) => writeFileSync(join(cwd, "feature.ts"), "x\n");
    said = "Add the feature";
    failWrite = "GitHub said no";

    const queued = queue();
    await expect(runTask(queued.id)).rejects.toThrow("GitHub said no");

    // The expensive half is done and saved, and the branch is still there.
    const checkout = join(home, "runs", queued.id, "checkout");
    expect(existsSync(checkout)).toBe(true);
    expect(git(checkout, "log", "-1", "--format=%s")).toBe("Add the feature");

    failWrite = null;
    agentDoes = () => {
      throw new Error("the agent must not be run a second time");
    };
    const done = await runTask(queued.id);
    expect(done.state).toBe("done");
    expect(existsSync(checkout)).toBe(false);
  });
});
