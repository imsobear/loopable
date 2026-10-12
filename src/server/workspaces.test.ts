import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-workspaces-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { loops, runners, tasks, workspaces } = await import("./db/schema.ts");
const { createLoop, deleteLoop, getLoop, listLoops } = await import("./loops.ts");
const { draftForWorkflow } = await import("#/lib/loop-draft.ts");
const { enqueuePrompt, getTask, listTasks, updateTask } = await import("./tasks.ts");
const { getJoinToken, joinRunner, listRunners, runnerForToken } = await import("./runners.ts");
const { claimAgentJob } = await import("./runner-api.ts");
const { readSetting, writeSetting } = await import("./settings.ts");
const { LOCAL_WORKSPACE, withWorkspace, workspaceId } = await import("./workspace.ts");
const { RUNNER_PROTOCOL, VERSION } = await import("#/lib/version.ts");

await migrateIfNeeded();

const A = "workspace-a";
const B = "workspace-b";
const CODEX = [{ agentId: "codex", installed: true, version: "1", signedIn: true, detail: "ok" }];

const inA = <T>(work: () => Promise<T>) => withWorkspace(A, work);
const inB = <T>(work: () => Promise<T>) => withWorkspace(B, work);

function scheduleLoop() {
  return createLoop({
    ...draftForWorkflow("schedule", "schedule.recurring"),
    settings: { every: "day", at: "09:00", weekday: "1", folder: "code/web" },
  });
}

async function joined(workspace: string, hostname: string) {
  const token = await withWorkspace(workspace, () => getJoinToken());
  return await joinRunner({
    joinToken: token,
    hostname,
    inventory: CODEX,
    version: VERSION,
    protocol: RUNNER_PROTOCOL,
  });
}

beforeEach(async () => {
  await db().delete(tasks).run();
  await db().delete(loops).run();
  await db().delete(runners).run();
  await db().insert(workspaces).values({ id: A, name: "A" }).onConflictDoNothing().run();
  await db().insert(workspaces).values({ id: B, name: "B" }).onConflictDoNothing().run();
});

describe("a workspace", () => {
  it("sees only its own loops, even by id", async () => {
    const mine = await inA(scheduleLoop);
    await inB(scheduleLoop);

    expect((await inA(listLoops)).map((loop) => loop.id)).toEqual([mine.id]);
    expect(await inB(() => getLoop(mine.id))).toBeNull();
  });

  it("cannot delete another workspace's loop", async () => {
    const mine = await inA(scheduleLoop);
    await inB(() => deleteLoop(mine.id));
    expect(await inA(() => getLoop(mine.id))).not.toBeNull();
  });

  it("sees only its own tasks, and cannot change another's", async () => {
    await joined(A, "a-box");
    const asked = await inA(() => enqueuePrompt({ prompt: "Hello", agentId: "codex" }));

    expect(await inB(() => listTasks())).toEqual([]);
    expect(await inB(() => getTask(asked.id))).toBeNull();
    await inB(() => updateTask(asked.id, { state: "failed" }));
    expect((await inA(() => getTask(asked.id)))?.state).toBe("queued");
  });

  it("keeps its own settings", async () => {
    await inA(() => writeSetting("defaultAgentId", "codex"));
    expect(await inB(() => readSetting("defaultAgentId", null))).toBeNull();
  });
});

describe("runners", () => {
  it("join the workspace whose token they bring, and only show there", async () => {
    await joined(A, "a-box");
    await joined(B, "b-box");

    expect((await inA(listRunners)).map((runner) => runner.hostname)).toEqual(["a-box"]);
    expect((await inB(listRunners)).map((runner) => runner.hostname)).toEqual(["b-box"]);
  });

  it("get a different join token in each workspace", async () => {
    expect(await inA(getJoinToken)).not.toBe(await inB(getJoinToken));
  });

  it("are found by their token and know their workspace", async () => {
    const { runnerToken } = await joined(B, "b-box");
    expect((await runnerForToken(runnerToken))?.workspaceId).toBe(B);
    expect(await runnerForToken("not-a-token")).toBeNull();
  });

  it("never claim another workspace's task", async () => {
    const a = await joined(A, "a-box");
    const b = await joined(B, "b-box");
    const asked = await inA(() => enqueuePrompt({ prompt: "Hello", agentId: "codex" }));
    // Pretend it was handed to B's runner, which must still not be able to take it.
    await db().update(tasks).set({ state: "awaiting_agent", runnerId: b.runnerId }).run();

    expect(await inB(() => claimAgentJob(b.runnerId))).toBeNull();
    await db().update(tasks).set({ runnerId: a.runnerId }).run();
    expect((await inA(() => claimAgentJob(a.runnerId)))?.taskId).toBe(asked.id);
  });
});

describe("the scope", () => {
  it("is the local workspace on a local install", () => {
    expect(workspaceId()).toBe(LOCAL_WORKSPACE);
  });

  it("is required when hosted, so a forgotten scope fails instead of reading everyone's", () => {
    const before = process.env.LOOPABLE_DATABASE_URL;
    process.env.LOOPABLE_DATABASE_URL = "libsql://example.turso.io";
    try {
      expect(() => workspaceId()).toThrow(/Sign in/);
      expect(withWorkspace(A, () => workspaceId())).toBe(A);
    } finally {
      if (before === undefined) delete process.env.LOOPABLE_DATABASE_URL;
      else process.env.LOOPABLE_DATABASE_URL = before;
    }
  });
});
