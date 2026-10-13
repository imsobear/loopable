import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getViewer } from "#/connectors/github/api.ts";
import * as github from "#/connectors/github/oauth.ts";
import * as google from "#/connectors/gmail/oauth.ts";
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
 * Signing in to hosted Loopable, with GitHub or Google. Either one says who
 * you are without Loopable ever holding a password.
 *
 * Signing in asks only who you are. Reaching your repositories or your mail is
 * a separate step, a connection, which may well be a different account. A
 * GitHub sign-in and a Google sign-in are two accounts, even with the same
 * email: joining them on an address would let whoever controls one provider's
 * account walk into the other's workspace.
 */
export const SESSION_COOKIE = "loopable_session";
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SignInProvider = "github" | "google";

export function isSignInProvider(value: unknown): value is SignInProvider {
  return value === "github" || value === "google";
}

/** Who a provider says someone is, the same shape whichever it was. */
export type Profile = {
  provider: SignInProvider;
  /** The provider's stable id for the account. */
  subject: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

type Provider = {
  label: string;
  /** Which app registration this uses; Google sign-in shares the Gmail client. */
  registration: string;
  /**
   * The connection's own callback, shared so one registered address covers
   * both, signing in and connecting. The callback tells a sign-in apart by
   * its state.
   */
  callbackPath: string;
  authorizeUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string }): string;
  profile(input: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }): Promise<Profile>;
};

const PROVIDERS: Record<SignInProvider, Provider> = {
  github: {
    label: "GitHub",
    registration: "github",
    callbackPath: "/api/connectors/github/callback",
    authorizeUrl: (input) => github.buildAuthorizeUrl({ ...input, scopes: ["read:user"] }),
    async profile(input) {
      const credential = await github.exchangeCode(input);
      const { user } = await getViewer(credential.accessToken);
      return {
        provider: "github",
        subject: String(user.id),
        login: user.login,
        name: user.name ?? null,
        email: null,
        avatarUrl: user.avatar_url,
      };
    },
  },
  google: {
    label: "Google",
    registration: "gmail",
    callbackPath: "/api/connectors/gmail/callback",
    authorizeUrl: (input) => google.buildSignInUrl(input),
    async profile(input) {
      const credential = await google.exchangeCode(input);
      const person = await google.getUserInfo(credential.accessToken);
      return {
        provider: "google",
        subject: person.sub,
        login: person.email ?? person.sub,
        name: person.name ?? null,
        email: person.email ?? null,
        avatarUrl: person.picture ?? null,
      };
    },
  },
};

/** Where the provider sends the browser back after sign-in. */
export function signInCallbackPath(provider: SignInProvider = "github"): string {
  return PROVIDERS[provider].callbackPath;
}

function registration(provider: SignInProvider) {
  const app = oauthAppRegistration(PROVIDERS[provider].registration);
  if (!app) {
    throw new Error(`Signing in with ${PROVIDERS[provider].label} is not set up here.`);
  }
  return app;
}

/** The URL to send someone to the provider with, having remembered how to finish. */
export async function startSignIn(input: {
  provider?: SignInProvider;
  origin: string;
  returnTo?: string;
}): Promise<string> {
  const provider = input.provider ?? "github";
  const app = registration(provider);
  const now = Date.now();
  await db().delete(signInAttempts).where(lt(signInAttempts.expiresAt, new Date(now))).run();
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = github.createPkce();
  const redirectUri = `${input.origin}${signInCallbackPath(provider)}`;
  await db()
    .insert(signInAttempts)
    .values({
      state,
      provider,
      verifier,
      redirectUri,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(now + ATTEMPT_TTL_MS),
    })
    .run();
  return PROVIDERS[provider].authorizeUrl({ clientId: app.clientId, redirectUri, state, challenge });
}

/**
 * Which provider a callback's state started a sign-in with, or null when it is
 * not a sign-in (it is then a connection being made, or nothing at all).
 */
export async function signInProviderFor(state: string | null): Promise<SignInProvider | null> {
  if (!state) return null;
  const attempt = await db()
    .select({ provider: signInAttempts.provider })
    .from(signInAttempts)
    .where(eq(signInAttempts.state, state))
    .get();
  return attempt?.provider ?? null;
}

/** Only a path on this site, so a sign-in link cannot be used to send someone elsewhere. */
export function safeReturnTo(value: string | undefined | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export type SignedIn = { sessionToken: string; user: User; workspaceId: string; returnTo: string | null };

type ProfileFor = (input: {
  provider: SignInProvider;
  code: string;
  redirectUri: string;
  verifier: string;
}) => Promise<Profile>;

/**
 * Finishing a sign-in: who the provider says this is, their workspace (made on
 * the first sign-in), and a new session. `profileFor` is swapped out in tests.
 */
export async function completeSignIn(
  input: { provider?: SignInProvider; code: string; state: string },
  profileFor: ProfileFor = providerProfile,
): Promise<SignedIn> {
  const provider = input.provider ?? "github";
  const attempt = await db()
    .select()
    .from(signInAttempts)
    .where(eq(signInAttempts.state, input.state))
    .get();
  if (attempt) await db().delete(signInAttempts).where(eq(signInAttempts.state, input.state)).run();
  // A state from one provider's sign-in is no good at the other's callback.
  if (!attempt || attempt.provider !== provider || attempt.expiresAt.getTime() < Date.now()) {
    throw new Error("That sign-in link has expired. Sign in again.");
  }

  const profile = await profileFor({
    provider,
    code: input.code,
    redirectUri: attempt.redirectUri,
    verifier: attempt.verifier,
  });
  if (profile.provider !== provider) throw new Error("That sign-in came back from the wrong place.");
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

function providerProfile(input: Parameters<ProfileFor>[0]): Promise<Profile> {
  const app = registration(input.provider);
  return PROVIDERS[input.provider].profile({ ...app, ...input });
}

async function upsertUser(profile: Profile): Promise<User> {
  const column = profile.provider === "github" ? users.githubId : users.googleId;
  const values = {
    login: profile.login,
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  };
  const existing = await db().select().from(users).where(eq(column, profile.subject)).get();
  if (existing) {
    await db().update(users).set(values).where(eq(users.id, existing.id)).run();
    return { ...existing, ...values };
  }
  const id = randomUUID();
  const identity =
    profile.provider === "github" ? { githubId: profile.subject } : { googleId: profile.subject };
  await db().insert(users).values({ id, ...identity, ...values }).run();
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

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

/** Who is looking at the app right now, for the page to show. Null under `pnpm dev`. */
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
