import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "loopable-accounts-"));
process.env.LOOPABLE_HOME = home;
process.env.LOOPABLE_DB = join(home, "test.sqlite");
process.env.LOOPABLE_KEYCHAIN = "0";
// Test apps, so a checkout with no config/oauth-app.json (CI) can sign in.
process.env.LOOPABLE_GITHUB_CLIENT_ID = "test-github";
process.env.LOOPABLE_GITHUB_CLIENT_SECRET = "test-github-secret";
process.env.LOOPABLE_GMAIL_CLIENT_ID = "test-gmail";
process.env.LOOPABLE_GMAIL_CLIENT_SECRET = "test-gmail-secret";

const { db, migrateIfNeeded } = await import("./db/client.ts");
const { sessions } = await import("./db/schema.ts");
const {
  completeSignIn,
  safeReturnTo,
  sessionFor,
  sessionTokenFrom,
  signInProviderFor,
  signOut,
  startSignIn,
  viewerInScope,
} = await import("./accounts.ts");
const { withWorkspace } = await import("./workspace.ts");
type Profile = import("./accounts.ts").Profile;

await migrateIfNeeded();

const maya: Profile = {
  provider: "github",
  subject: "101",
  login: "maya",
  name: "Maya Chen",
  email: null,
  avatarUrl: "https://a/maya.png",
};
const mayaOnGoogle: Profile = {
  provider: "google",
  subject: "g-101",
  login: "maya@example.com",
  name: "Maya Chen",
  email: "maya@example.com",
  avatarUrl: null,
};

/** A sign-in from start to finish, with the provider replaced by a profile. */
async function signIn(profile = maya, returnTo?: string) {
  const provider = profile.provider;
  const url = new URL(await startSignIn({ provider, origin: "https://loop.example", returnTo }));
  const state = url.searchParams.get("state")!;
  return await completeSignIn({ provider, code: "code", state }, async () => profile);
}

describe("signing in", () => {
  it("asks GitHub only who you are, and comes back to the GitHub callback", async () => {
    const url = new URL(await startSignIn({ origin: "https://loop.example" }));
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://loop.example/api/connectors/github/callback",
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
    const theirs = await signIn({ ...maya, subject: "202", login: "wei", name: "Wei" });
    expect(theirs.workspaceId).not.toBe(mine.workspaceId);
  });

  it("asks Google only who you are, and comes back to the Gmail callback", async () => {
    const url = new URL(await startSignIn({ provider: "google", origin: "https://loop.example" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://loop.example/api/connectors/gmail/callback",
    );
  });

  it("keeps a Google sign-in apart from a GitHub one, even for the same person", async () => {
    const onGithub = await signIn();
    const onGoogle = await signIn(mayaOnGoogle);
    const again = await signIn(mayaOnGoogle);
    expect(onGoogle.user.id).not.toBe(onGithub.user.id);
    expect(onGoogle.workspaceId).not.toBe(onGithub.workspaceId);
    expect(again.user.id).toBe(onGoogle.user.id);
    expect(onGoogle.user.email).toBe("maya@example.com");
  });

  it("is told apart from a connection by its state", async () => {
    const url = new URL(await startSignIn({ provider: "google", origin: "https://loop.example" }));
    expect(await signInProviderFor(url.searchParams.get("state"))).toBe("google");
    expect(await signInProviderFor("a-connection-state")).toBeNull();
    expect(await signInProviderFor(null)).toBeNull();
  });

  it("will not finish one provider's sign-in at the other's callback", async () => {
    const url = new URL(await startSignIn({ provider: "github", origin: "https://loop.example" }));
    const state = url.searchParams.get("state")!;
    await expect(
      completeSignIn({ provider: "google", code: "c", state }, async () => mayaOnGoogle),
    ).rejects.toThrow(/expired/);
  });

  it("uses a sign-in link once", async () => {
    const url = new URL(await startSignIn({ origin: "https://loop.example" }));
    const state = url.searchParams.get("state")!;
    await completeSignIn({ code: "c", state }, async () => maya);
    await expect(completeSignIn({ code: "c", state }, async () => maya)).rejects.toThrow(/expired/);
  });

  it("returns only to a page on this site", async () => {
    expect((await signIn(maya, "/loops?tab=tasks")).returnTo).toBe("/loops?tab=tasks");
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
