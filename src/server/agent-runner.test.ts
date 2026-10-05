import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-agent-runner-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");

const { runAgentJob } = await import("./agent-runner.ts");
const { WORKSPACE } = await import("./agent-job.ts");

const baseJob = {
  taskId: "task-1",
  agentId: "codex",
  prompt: "Review it.",
  settings: { permissionMode: "read_only" as const, model: null, timeoutMs: 60_000 },
  files: [{ name: "pr.md", body: "# PR\n" }],
};

describe("runAgentJob", () => {
  it("writes the files and invokes the agent; it does not interpret the job", async () => {
    const result = await runAgentJob(baseJob, {
      run: async (input) => {
        expect(input.prompt).toContain("Review it.");
        return { ok: true, output: "Looks fine.", durationMs: 12, command: "codex exec" };
      },
    });
    expect(result).toMatchObject({ ok: true, output: "Looks fine.", command: "codex exec" });
  });

  it("runs in a throwaway workspace when the job has no cwd", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "loopable-job-"));
    await runAgentJob(
      { ...baseJob, taskId: "task-2" },
      {
        workspace,
        run: async (input) => {
          expect(input.cwd).toBe(workspace);
          return { ok: true, output: "ok", durationMs: 1, command: "codex exec" };
        },
      },
    );
  });

  it("fills in its own workspace where the prompt names context files", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "loopable-job-"));
    const folder = mkdtempSync(join(tmpdir(), "loopable-folder-"));
    await runAgentJob(
      { ...baseJob, taskId: "task-4", cwd: folder, prompt: `Read ${WORKSPACE}/pr.md first.` },
      {
        workspace,
        run: async (input) => {
          expect(input.prompt).toBe(`Read ${workspace}/pr.md first.`);
          return { ok: true, output: "ok", durationMs: 1, command: "codex exec" };
        },
      },
    );
  });

  it("fails without running when this runner has no such folder", async () => {
    const result = await runAgentJob(
      { ...baseJob, taskId: "task-5", cwd: "no/such/folder-for-loopable-tests" },
      {
        workspace: mkdtempSync(join(tmpdir(), "loopable-job-")),
        run: async () => {
          throw new Error("should not run");
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/There is no folder at .*no\/such\/folder-for-loopable-tests on this runner/);
  });

  it("runs in the folder the job names, even when a workspace is also given", async () => {
    const folder = mkdtempSync(join(tmpdir(), "loopable-folder-"));
    const workspace = mkdtempSync(join(tmpdir(), "loopable-job-"));
    mkdirSync(folder, { recursive: true });
    await runAgentJob(
      { ...baseJob, taskId: "task-3", cwd: folder, files: [{ name: "MESSAGE.md", body: "hi\n" }] },
      {
        workspace,
        run: async (input) => {
          expect(input.cwd).toBe(folder);
          return { ok: true, output: "ok", durationMs: 1, command: "codex exec" };
        },
      },
    );
  });
});
