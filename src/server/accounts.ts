import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getViewer } from "#/connectors/github/api.ts";
import { buildAuthorizeUrl, createPkce, exchangeCode } from "#/connectors/github/oauth.ts";
import { oauthAppRegistration } from "#/connectors/oauth-app.ts";
import { db } from "./db/client.ts";
import {
  members,
  sessions,
  signInAttempts,
  users,
  workspaces,
  type User,
} from "./db/schema.ts";
import { currentScope } from "./workspace.ts";

/**
 * Signing in to hosted Loopable. GitHub is the only way in: the people this is
 * for already have an account there, and it says who they are without
 * Loopable ever holding a password.
 *
 * Signing in asks GitHub only who you are. Reaching your repositories is a
 * separate step, the GitHub connection, which may well be a different account.
 */
export const SESSION_COOKIE = "loopable_session";
const SIGN_IN_SCOPES = ["read:user"];
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Where GitHub sends the browser back after sign-in. */
export function signInCallbackPath(): string {
  // Under the GitHub connection's own callback, so one registered callback URL
  // covers both: GitHub accepts any path beneath the one registered.
  return "/api/connectors/github/callback/signin";
}

function registration() {
  const app = oauthAppRegistration("github");
  if (!app) throw new Error("Sign-in is not set up: this build has no GitHub app registration.");
  return app;
}

/** The URL to send someone to GitHub with, having remembered how to finish. */
export async function startSignIn(input: { origin: string; returnTo?: string }): Promise<string> {
  const now = Date.now();
  await db().delete(signInAttempts).where(lt(signInAttempts.expiresAt, new Date(now))).run();
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = createPkce();
  const redirectUri = `${input.origin}${signInCallbackPath()}`;
  await db()
    .insert(signInAttempts)
    .values({
      state,
      verifier,
      redirectUri,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(now + ATTEMPT_TTL_MS),
    })
    .run();
  return buildAuthorizeUrl({
    clientId: registration().clientId,
    redirectUri,
    state,
    challenge,
    scopes: SIGN_IN_SCOPES,
  });
}

/** Only a path on this site, so a sign-in link cannot be used to send someone elsewhere. */
export function safeReturnTo(value: string | undefined | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export type SignedIn = { sessionToken: string; user: User; workspaceId: string; returnTo: string | null };

type GithubProfile = { id: number; login: string; name?: string | null; avatar_url: string };

/**
 * Finishing a sign-in: who GitHub says this is, their workspace (made on the
 * first sign-in), and a new session. `profileFor` is swapped out in tests.
 */
export async function completeSignIn(
  input: { code: string; state: string },
  profileFor: (code: string, redirectUri: string, verifier: string) => Promise<GithubProfile> = githubProfile,
): Promise<SignedIn> {
  const attempt = await db()
    .select()
    .from(signInAttempts)
    .where(eq(signInAttempts.state, input.state))
    .get();
  if (attempt) await db().delete(signInAttempts).where(eq(signInAttempts.state, input.state)).run();
  if (!attempt || attempt.expiresAt.getTime() < Date.now()) {
    throw new Error("That sign-in link has expired. Sign in again.");
  }

  const profile = await profileFor(input.code, attempt.redirectUri, attempt.verifier);
  const user = await upsertUser(profile);
  const workspaceId = await workspaceFor(user);
  const sessionToken = randomBytes(32).toString("base64url");
  await db()
    .insert(sessions)
    .values({
      id: hash(sessionToken),
      userId: user.id,
      workspaceId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .run();
  return { sessionToken, user, workspaceId, returnTo: attempt.returnTo };
}

async function githubProfile(code: string, redirectUri: string, verifier: string): Promise<GithubProfile> {
  const app = registration();
  const credential = await exchangeCode({
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    code,
    redirectUri,
    verifier,
  });
  return (await getViewer(credential.accessToken)).user;
}

async function upsertUser(profile: GithubProfile): Promise<User> {
  const githubId = String(profile.id);
  const values = { login: profile.login, name: profile.name ?? null, avatarUrl: profile.avatar_url };
  const existing = await db().select().from(users).where(eq(users.githubId, githubId)).get();
  if (existing) {
    await db().update(users).set(values).where(eq(users.id, existing.id)).run();
    return { ...existing, ...values };
  }
  const id = randomUUID();
  await db().insert(users).values({ id, githubId, ...values }).run();
  return (await db().select().from(users).where(eq(users.id, id)).get())!;
}

/** The workspace someone works in: their first, or a new one named after them. */
async function workspaceFor(user: User): Promise<string> {
  const membership = await db().select().from(members).where(eq(members.userId, user.id)).get();
  if (membership) return membership.workspaceId;
  const id = randomUUID();
  await db().insert(workspaces).values({ id, name: user.login }).run();
  await db().insert(members).values({ workspaceId: id, userId: user.id, role: "owner" }).run();
  return id;
}

export type Viewer = {
  user: { id: string; login: string; name: string | null; avatarUrl: string | null };
  workspace: { id: string; name: string };
};

/** Who a session cookie belongs to, or null when it is missing, wrong, or expired. */
export async function sessionFor(token: string | null): Promise<Viewer | null> {
  if (!token) return null;
  const row = await db()
    .select({
      userId: users.id,
      login: users.login,
      name: users.name,
      avatarUrl: users.avatarUrl,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(workspaces, eq(workspaces.id, sessions.workspaceId))
    .where(and(eq(sessions.id, hash(token)), gt(sessions.expiresAt, new Date())))
    .get();
  if (!row) return null;
  return {
    user: { id: row.userId, login: row.login, name: row.name, avatarUrl: row.avatarUrl },
    workspace: { id: row.workspaceId, name: row.workspaceName },
  };
}

export async function signOut(token: string | null): Promise<void> {
  if (!token) return;
  await db().delete(sessions).where(eq(sessions.id, hash(token))).run();
}

export function sessionTokenFrom(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** Who is looking at the app right now, for the page to show. Null on a local install. */
export async function viewerInScope(): Promise<Viewer | null> {
  const scope = currentScope();
  if (!scope?.userId) return null;
  const row = await db()
    .select({
      userId: users.id,
      login: users.login,
      name: users.name,
      avatarUrl: users.avatarUrl,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, scope.workspaceId))
    .where(eq(users.id, scope.userId))
    .get();
  if (!row) return null;
  return {
    user: { id: row.userId, login: row.login, name: row.name, avatarUrl: row.avatarUrl },
    workspace: { id: row.workspaceId, name: row.workspaceName },
  };
}
