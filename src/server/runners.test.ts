import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-runners-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { loops, runners, tasks } = await import("./db/schema.ts");
const { forgetRunner, getJoinToken, heartbeatRunner, joinRunner, listRunners, pickRunner } =
  await import("./runners.ts");
const { FOLDER_JOB_PROTOCOL, RUNNER_PROTOCOL, VERSION } = await import("#/lib/version.ts");

await migrateIfNeeded();

const CODEX = [
  { agentId: "codex", installed: true, version: "1", signedIn: true, detail: "ok" },
];

async function givenRunner(hostname: string, inventory = CODEX) {
  const joined = await joinRunner({
    joinToken: await getJoinToken(),
    hostname,
    inventory,
  });
  await heartbeatRunner(joined.runnerId, inventory);
  return joined;
}

beforeEach(async () => {
  await db().delete(tasks).run();
  await db().delete(loops).run();
  await db().delete(runners).run();
});

describe("pickRunner", () => {
  it("sends folder jobs to a runner on this host", async () => {
    const local = await givenRunner(osHostname());
    await givenRunner("other-box");
    expect(await pickRunner({ agentId: "codex", requiresHost: true })).toBe(
      local.runnerId,
    );
  });

  it("refuses folder jobs when no runner is on this host", async () => {
    await givenRunner("other-box");
    await expect(
      pickRunner({ agentId: "codex", requiresHost: true }),
    ).rejects.toThrow("same host as Loopable");
  });

  it("prefers an idle runner that has the agent", async () => {
    const first = await givenRunner("box-a");
    expect(await pickRunner({ agentId: "codex", requiresHost: false })).toBe(
      first.runnerId,
    );
  });

  it("refuses when no runner is online", async () => {
    await expect(
      pickRunner({ agentId: "codex", requiresHost: false }),
    ).rejects.toThrow("No runner is online");
  });
});

describe("runner versions", () => {
  it("counts a runner that says nothing as the first protocol, and out of date", async () => {
    await givenRunner("old-box");
    const [view] = await listRunners();
    expect(view).toMatchObject({ version: null, protocol: 1, outdated: true });
  });

  it("keeps what a runner says on every heartbeat", async () => {
    const { runnerId } = await givenRunner("new-box");
    await heartbeatRunner(runnerId, CODEX, { version: VERSION, protocol: RUNNER_PROTOCOL });
    const [view] = await listRunners();
    expect(view).toMatchObject({ version: VERSION, protocol: RUNNER_PROTOCOL, outdated: false });
  });

  it("sends a job needing a newer protocol only to a runner that has it", async () => {
    const old = await givenRunner("old-box");
    await expect(
      pickRunner({ agentId: "codex", requiresHost: false, minProtocol: FOLDER_JOB_PROTOCOL }),
    ).rejects.toThrow(/too old for this job/);

    const fresh = await givenRunner("new-box");
    await heartbeatRunner(fresh.runnerId, CODEX, { version: VERSION, protocol: RUNNER_PROTOCOL });
    expect(
      await pickRunner({ agentId: "codex", requiresHost: false, minProtocol: FOLDER_JOB_PROTOCOL }),
    ).toBe(fresh.runnerId);
    // Anything else still goes to either.
    expect([old.runnerId, fresh.runnerId]).toContain(
      await pickRunner({ agentId: "codex", requiresHost: false }),
    );
  });
});

describe("joinRunner", () => {
  it("rejects a bad join token", async () => {
    await expect(
      joinRunner({ joinToken: "nope", hostname: "box-a", inventory: [] }),
    ).rejects.toThrow("join token");
  });

  it("reuses a row for the same hostname", async () => {
    const token = await getJoinToken();
    const first = await joinRunner({ joinToken: token, hostname: "box-a", inventory: CODEX });
    const second = await joinRunner({ joinToken: token, hostname: "box-a", inventory: CODEX });
    expect(second.runnerId).toBe(first.runnerId);
    expect(second.runnerToken).not.toBe(first.runnerToken);
  });
});

describe("forgetRunner", () => {
  it("refuses while a run is in flight", async () => {
    const joined = await givenRunner("box-a");
    await db()
      .insert(loops)
      .values({
        id: "loop-1",
        name: "T",
        connectorId: "github",
        workflowId: "github.review_requested",
        prompt: "x",
        actionConnectorId: "github",
        actionId: "github.submit_review",
        priority: 1,
      })
      .run();
    await db()
      .insert(tasks)
      .values({
        id: randomUUID(),
        loopId: "loop-1",
        connectorId: "github",
        state: "awaiting_agent",
        sourceUrl: "https://github.com/acme/web/pull/1",
        sourceKind: "pull_request",
        sourceRef: "acme/web#1",
        actionConnectorId: "github",
        actionId: "github.submit_review",
        runnerId: joined.runnerId,
      })
      .run();
    await expect(forgetRunner(joined.runnerId)).rejects.toThrow("in flight");
  });
});
