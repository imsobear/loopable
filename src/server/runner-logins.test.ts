import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-runner-login-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { runnerLogins, workspaces } = await import("./db/schema.ts");
const { approveRunnerLogin, describeRunnerLogin, normalizeCode, pollRunnerLogin, startRunnerLogin } =
  await import("./runner-logins.ts");
const { getJoinToken } = await import("./runners.ts");
const { withWorkspace } = await import("./workspace.ts");

await migrateIfNeeded();
await db().insert(workspaces).values({ id: "ws-maya", name: "maya" }).onConflictDoNothing().run();

const inMaya = <T>(work: () => Promise<T>) => withWorkspace("ws-maya", work);

describe("loopable login", () => {
  it("hands the workspace's join token to the CLI once it is approved, and only once", async () => {
    const login = await startRunnerLogin();
    expect(login.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await pollRunnerLogin(login.code, login.pollSecret)).toEqual({ state: "pending" });

    await inMaya(() => approveRunnerLogin(login.code));
    const answer = await pollRunnerLogin(login.code, login.pollSecret);
    expect(answer).toEqual({
      state: "approved",
      joinToken: await inMaya(getJoinToken),
      workspace: "maya",
    });
    expect(await pollRunnerLogin(login.code, login.pollSecret)).toEqual({ state: "expired" });
  });

  it("gives nothing to someone with the code but not the poll secret", async () => {
    const login = await startRunnerLogin();
    await inMaya(() => approveRunnerLogin(login.code));
    expect(await pollRunnerLogin(login.code, "guessed")).toEqual({ state: "expired" });
  });

  it("takes a code typed by hand", async () => {
    const login = await startRunnerLogin();
    const typed = login.code.toLowerCase().replace("-", " ");
    expect(normalizeCode(typed)).toBe(login.code);
    expect(await describeRunnerLogin(typed)).toBe("pending");
  });

  it("will not approve a code twice, or one that has expired", async () => {
    const login = await startRunnerLogin();
    await inMaya(() => approveRunnerLogin(login.code));
    await expect(inMaya(() => approveRunnerLogin(login.code))).rejects.toThrow(/already been used/);

    const late = await startRunnerLogin();
    await db().update(runnerLogins).set({ expiresAt: new Date(Date.now() - 1) }).run();
    await expect(inMaya(() => approveRunnerLogin(late.code))).rejects.toThrow(/expired/);
    expect(await pollRunnerLogin(late.code, late.pollSecret)).toEqual({ state: "expired" });
  });
});
