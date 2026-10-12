import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-accounts-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { sessions } = await import("./db/schema.ts");
const {
  completeSignIn,
  safeReturnTo,
  sessionFor,
  sessionTokenFrom,
  signOut,
  startSignIn,
  viewerInScope,
} = await import("./accounts.ts");
const { withWorkspace } = await import("./workspace.ts");

await migrateIfNeeded();

const maya = { id: 101, login: "maya", name: "Maya Chen", avatar_url: "https://a/maya.png" };

/** A sign-in from start to finish, with GitHub replaced by a profile. */
async function signIn(profile = maya, returnTo?: string) {
  const url = new URL(await startSignIn({ origin: "https://loop.example", returnTo }));
  const state = url.searchParams.get("state")!;
  return await completeSignIn({ code: "code", state }, async () => profile);
}

describe("signing in", () => {
  it("asks GitHub only who you are, and comes back under the GitHub callback", async () => {
    const url = new URL(await startSignIn({ origin: "https://loop.example" }));
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://loop.example/api/connectors/github/callback/signin",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("makes a workspace on the first sign-in and reuses it after", async () => {
    const first = await signIn();
    const again = await signIn({ ...maya, name: "Maya" });
    expect(again.workspaceId).toBe(first.workspaceId);
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.name).toBe("Maya");
  });

  it("gives someone else their own workspace", async () => {
    const mine = await signIn();
    const theirs = await signIn({ id: 202, login: "wei", name: "Wei", avatar_url: "" });
    expect(theirs.workspaceId).not.toBe(mine.workspaceId);
  });

  it("uses a sign-in link once", async () => {
    const url = new URL(await startSignIn({ origin: "https://loop.example" }));
    const state = url.searchParams.get("state")!;
    await completeSignIn({ code: "c", state }, async () => maya);
    await expect(completeSignIn({ code: "c", state }, async () => maya)).rejects.toThrow(/expired/);
  });

  it("returns only to a page on this site", async () => {
    expect((await signIn(maya, "/runners/connect?code=AB")).returnTo).toBe("/runners/connect?code=AB");
    expect(safeReturnTo("https://evil.example")).toBeNull();
    expect(safeReturnTo("//evil.example")).toBeNull();
  });
});

describe("a session", () => {
  it("says who it belongs to and which workspace", async () => {
    const signedIn = await signIn();
    const viewer = await sessionFor(signedIn.sessionToken);
    expect(viewer?.user.login).toBe("maya");
    expect(viewer?.workspace.id).toBe(signedIn.workspaceId);
    expect(viewer?.workspace.name).toBe("maya");
  });

  it("is read from the cookie", () => {
    const request = new Request("https://loop.example", {
      headers: { cookie: "other=1; loopable_session=abc%3D; more=2" },
    });
    expect(sessionTokenFrom(request)).toBe("abc=");
  });

  it("is nobody's when wrong, expired, or signed out", async () => {
    expect(await sessionFor("not-a-session")).toBeNull();
    const expired = await signIn();
    await db().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    expect(await sessionFor(expired.sessionToken)).toBeNull();

    const current = await signIn();
    await signOut(current.sessionToken);
    expect(await sessionFor(current.sessionToken)).toBeNull();
  });

  it("is what the page shows as the viewer", async () => {
    const signedIn = await signIn();
    const viewer = await withWorkspace(signedIn.workspaceId, () => viewerInScope(), signedIn.user.id);
    expect(viewer?.user.login).toBe("maya");
    expect(await viewerInScope()).toBeNull();
  });
});
