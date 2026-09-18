import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSource } from "#/connectors/types.ts";
import type { ConnectionSettings } from "#/lib/domain.ts";

const home = mkdtempSync(join(tmpdir(), "loopable-tasks-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";

/** Every write any connector was asked to make, in order. */
type Write = {
  connectorId: string;
  actionId: string;
  target: Record<string, unknown>;
  source: ActionSource;
  body: string;
  comments: unknown[];
  changes?: { branch: string; base: string; repo: string; stat: string };
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
/** Extra fields the connector should add to the work item. */
let workItem: Record<string, unknown> = {};

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
      checkout: {
        url: "https://github.com/acme/web.git",
        ref: "pull/7/head",
        sha: "abc123",
        base: "main",
        repo: "acme/web",
      },
      context: [{ name: "PULL_REQUEST.md", body: "the pull request" }],
      ...workItem,
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

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { loops, runners, tasks } = await import("./db/schema.ts");
const { enqueuePrompt, enqueueTask, getTask, jobForTask, runAssignedAgent, runTask, taskRow } =
  await import("./tasks.ts");
const { getJoinToken, joinRunner } = await import("./runners.ts");
const { branchFor } = await import("./checkout.ts");

await migrateIfNeeded();

const LOOP_ID = "loop-under-test";

async function driveTask(id: string) {
  await runTask(id);
  await runAssignedAgent(id);
  if ((await taskRow(id))?.state === "applying") await runTask(id);
  return (await getTask(id))!;
}

/** Nothing like the workflow's own words, so the two cannot be confused. */
const PROMPT = "Only say whether the lockfile changed.";

/** A loop that watches GitHub, with where it writes left to the caller. */
async function givenLoop(action: {
  actionConnectorId: string;
  actionId: string;
  actionTarget?: ConnectionSettings;
}): Promise<void> {
  await db()
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

beforeEach(async () => {
  await db().delete(tasks).run();
  await db().delete(loops).run();
  await db().delete(runners).run();
  writes.length = 0;
  said = "";
  asked = "";
  ranIn = "";
  agentDoes = null;
  failWrite = null;
  workItem = {};
  await joinRunner({
    joinToken: await getJoinToken(),
    hostname: osHostname(),
    inventory: [
      { agentId: "cursor-agent", installed: true, version: "1", signedIn: true, detail: "ok" },
    ],
  });
});

describe("what the agent is asked", () => {
  it("is the loop's own words, not the words its workflow still has", async () => {
    // The point of copying the prompt onto the loop: once someone has changed
    // it, the template is history and must not creep back in.
    await givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    await driveTask(queued.id);

    expect(asked).toContain(PROMPT);
    expect(asked).not.toContain("the way an experienced engineer on this team would");
  });

  it("puts clone instructions in the prompt, not on the job", async () => {
    await givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    await runTask(queued.id);
    const job = await jobForTask(queued.id);

    expect("clone" in job).toBe(false);
    expect("runsIn" in job).toBe(false);
    expect(job.cwd).toBeUndefined();
    expect(job.prompt).toContain("Read PULL_REQUEST.md first.");
    expect(job.prompt).toContain("Clone https://github.com/acme/web.git");
    expect(job.prompt).toContain("pull/7/head");
    expect(job.prompt).toContain("Do not commit or push");
    expect(job.settings.permissionMode).toBe("workspace_write");
  });

  it("names a host folder as cwd and leaves the rest to the prompt", async () => {
    const folder = mkdtempSync(join(tmpdir(), "loopable-folder-"));
    await db()
      .insert(loops)
      .values({
        id: LOOP_ID,
        name: "Ask the bot",
        priority: 1,
        connectorId: "wechat",
        workflowId: "wechat.ask",
        prompt: "Answer them.",
        settings: { folder },
        actionConnectorId: "wechat",
        actionId: "wechat.reply",
        actionTarget: {},
      })
      .run();

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: true,
    });
    await runTask(queued.id);
    const job = await jobForTask(queued.id);

    expect("runsIn" in job).toBe(false);
    expect(job.cwd).toBe(folder);
    expect(job.prompt).toContain(`Read ${join(home, "runs", queued.id, "PULL_REQUEST.md")} first.`);
  });
});

describe("runTask", () => {
  it("writes with the connector that read it, when they are the same", async () => {
    await givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = JSON.stringify({
      summary: "Looks right.",
      findings: [{ path: "src/a.ts", line: 4, body: "Name this." }],
    });

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    const done = await driveTask(queued.id);

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
    await givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    await db()
      .update(tasks)
      .set({ error: "GitHub answered 500", attempts: 1 })
      .where(eq(tasks.id, queued.id))
      .run();

    const done = await driveTask(queued.id);

    expect(done.state).toBe("done");
    expect(done.error).toBeNull();
  });

  it("writes with the connector the loop chose, on its own account", async () => {
    // Asked for a review on GitHub, answered in a chat: the case a loop with
    // one connector could not express at all.
    await givenLoop({
      actionConnectorId: "wechat",
      actionId: "wechat.reply",
      actionTarget: { to: "me" },
    });
    said = JSON.stringify({
      summary: "Two things to fix.",
      findings: [{ path: "src/a.ts", line: 4, body: "Name this." }],
    });

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    const done = await driveTask(queued.id);

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
    await givenLoop({ actionConnectorId: "wechat", actionId: "wechat.reply" });
    said = "Nothing to worry about.";

    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });
    await driveTask(queued.id);

    expect(writes[0]!.source.carry).toBeUndefined();
  });

  it("stays with what it was queued with after the loop is pointed elsewhere", async () => {
    await givenLoop({ actionConnectorId: "github", actionId: "github.submit_review" });
    said = "Looks right.";
    const queued = await enqueueTask({
      loopId: LOOP_ID,
      url: "https://github.com/acme/web/pull/7",
      dryRun: false,
    });

    await db()
      .update(loops)
      .set({ actionConnectorId: "wechat", actionId: "wechat.reply" })
      .run();
    await driveTask(queued.id);

    expect(writes[0]!.connectorId).toBe("github");
  });
});

describe("a loop that writes code", () => {
  let root: string;
  let origin: string;

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  async function givenCodeLoop(): Promise<void> {
    await db()
      .insert(loops)
      .values({
        id: LOOP_ID,
        name: "Implement things",
        priority: 1,
        connectorId: "github",
        workflowId: "github.issue_implement",
        prompt: PROMPT,
        settings: {},
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

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "loopable-code-"));
    origin = join(root, "origin.git");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--bare", "--initial-branch=main", ".");
    const seed = join(root, "seed");
    git(root, "clone", "--quiet", origin, "seed");
    git(seed, "config", "user.email", "t@localhost");
    git(seed, "config", "user.name", "T");
    writeFileSync(join(seed, "README.md"), "hello\n");
    git(seed, "add", "-A");
    git(seed, "commit", "--quiet", "-m", "first");
    git(seed, "push", "--quiet", "origin", "main");
    workItem = {
      kind: "issue",
      ref: "acme/web#7",
      title: "Add a feature",
      url: "https://github.com/acme/web/issues/7",
      context: [{ name: "ISSUE.md", body: "the issue" }],
      checkout: { url: origin, ref: "main", base: "main", repo: "acme/web" },
    };
    await givenCodeLoop();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function pushAsAgent(branch: string, file: string, body: string) {
    return (cwd: string) => {
      git(cwd, "clone", "--quiet", origin, "repo");
      const repo = join(cwd, "repo");
      git(repo, "config", "user.email", "a@localhost");
      git(repo, "config", "user.name", "Agent");
      git(repo, "checkout", "-B", branch);
      writeFileSync(join(repo, file), body);
      git(repo, "add", "-A");
      git(repo, "commit", "--quiet", "-m", "Add the feature");
      git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${branch}`);
    };
  }

  it("tells the agent which branch to push, then opens a pull request for it", async () => {
    const queued = await queue();
    const branch = branchFor({ ref: "acme/web#7", taskId: queued.id });
    agentDoes = pushAsAgent(branch, "feature.ts", "export const x = 1;\n");
    said = "Add the feature\n\nIt does the thing.";

    const done = await driveTask(queued.id);

    expect(asked).toContain(`Clone ${origin}`);
    expect(asked).toContain(branch);
    expect(done.state).toBe("done");
    expect(writes[0]!.changes).toMatchObject({
      branch,
      base: "main",
      repo: "acme/web",
    });
    expect(git(origin, "log", "-1", "--format=%s", branch)).toBe("Add the feature");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("first");
  });

  it("leaves git to the agent", async () => {
    const queued = await queue();
    agentDoes = pushAsAgent(
      branchFor({ ref: "acme/web#7", taskId: queued.id }),
      "feature.ts",
      "x\n",
    );
    said = "Add the feature";

    await runTask(queued.id);
    expect("clone" in (await jobForTask(queued.id))).toBe(false);
    await driveTask(queued.id);

    expect(ranIn).not.toBe(origin);
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("first");
  });

  it("skips when the agent says there is nothing to do", async () => {
    agentDoes = null;
    said = "NOTHING_TO_DO";

    const done = await driveTask((await queue()).id);

    expect(done.state).toBe("skipped");
    expect(writes).toHaveLength(0);
  });

  it("keeps the pushed branch when the write failed, so a retry need not run the agent again", async () => {
    const queued = await queue();
    const branch = branchFor({ ref: "acme/web#7", taskId: queued.id });
    agentDoes = pushAsAgent(branch, "feature.ts", "x\n");
    said = "Add the feature";
    failWrite = "GitHub said no";

    await runTask(queued.id);
    await runAssignedAgent(queued.id);
    await expect(runTask(queued.id)).rejects.toThrow("GitHub said no");

    expect(git(origin, "log", "-1", "--format=%s", branch)).toBe("Add the feature");

    failWrite = null;
    agentDoes = () => {
      throw new Error("the agent must not be run a second time");
    };
    const done = await runTask(queued.id);
    expect(done.state).toBe("done");
  });
});

describe("a prompt from the inbox", () => {
  it("queues a task with no loop and the chosen agent", async () => {
    const queued = await enqueuePrompt({
      prompt: "Say hello in one word.",
      agentId: "cursor-agent",
    });

    expect(queued.loopId).toBeNull();
    expect(queued.loopName).toBe("Test run");
    expect(queued.agentId).toBe("cursor-agent");
    expect(queued.sourceKind).toBe("prompt");
    expect(queued.sourceTitle).toBe("Say hello in one word.");
    expect(queued.state).toBe("queued");
    expect(queued.dryRun).toBe(false);
  });

  it("rejects a blank prompt", async () => {
    await expect(enqueuePrompt({ prompt: "  \n", agentId: "cursor-agent" })).rejects.toThrow(
      "Write a prompt",
    );
  });

  it("rejects an agent nobody has signed in", async () => {
    await db().delete(runners).run();
    await expect(
      enqueuePrompt({ prompt: "Say hello.", agentId: "cursor-agent" }),
    ).rejects.toThrow("No runner is online that can run this agent.");
  });

  it("runs on a runner and keeps the reply in the inbox, without writing anywhere", async () => {
    said = "hello";
    const queued = await enqueuePrompt({
      prompt: "Say hello in one word.",
      agentId: "cursor-agent",
    });
    const done = await driveTask(queued.id);

    expect(asked).toBe("Say hello in one word.");
    expect(done.state).toBe("prepared");
    expect(done.output).toBe("hello");
    expect(writes).toHaveLength(0);
  });
});
