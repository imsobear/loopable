import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  credential: unknown;
};
const writes: Write[] = [];

/** What the agent will say, and what it was asked. Set per test. */
let said = "";
let asked = "";

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
      return { url: `https://${id}.test/written` };
    },
  }),
}));

vi.mock("./connections.ts", () => ({
  credentialForConnector: async (id: string) => ({ credential: `credential for ${id}` }),
}));

vi.mock("#/agents/runtimes.ts", () => ({
  agentRuntime: () => ({
    run: async (input: { prompt: string }) => {
      asked = input.prompt;
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
