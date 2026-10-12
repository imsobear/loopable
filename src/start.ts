import { appOrigin, isLoopbackHost } from "#/lib/callback.ts";
import { isHosted } from "#/lib/hosted.ts";
import { sessionFor, sessionTokenFrom } from "#/server/accounts.ts";
import { LOCAL_WORKSPACE, withWorkspace } from "#/server/workspace.ts";
import {
  appAccessCookie,
  assertAppAccess,
  isPublicApiPath,
  readAppToken,
} from "#/server/access.ts";
import { migrateIfNeeded } from "#/server/db/client.ts";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

let migrated: Promise<void> | null = null;
function ensureMigrated() {
  migrated ??= migrateIfNeeded();
  return migrated;
}

/** Pages anyone may see without signing in. */
const PUBLIC_PAGES = new Set(["/", "/welcome"]);

/** A browser asking for a page, as opposed to a server function, an API call or a file. */
function isPageRequest(request: Request, pathname: string): boolean {
  if (request.method !== "GET") return false;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_serverFn")) return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Hosted: whoever the session cookie says, inside their workspace. A page
 * that needs someone signed in sends a stranger to the front page instead;
 * anything else carries on unscoped, and fails as soon as it asks whose data
 * it is (see server/workspace.ts).
 *
 * Local: loopback is open, anything else needs LOOPABLE_APP_TOKEN, and
 * everything is the one local workspace.
 */
const appAccess = createMiddleware({ type: "request" }).server(async ({ next, request, pathname }) => {
  await ensureMigrated();

  if (isHosted()) {
    // The session first, even on public paths: starting a connection's
    // authorization is one of those, and it has to know whose it will be.
    const viewer = await sessionFor(sessionTokenFrom(request));
    if (viewer) return withWorkspace(viewer.workspace.id, () => next(), viewer.user.id);
    if (isPublicApiPath(pathname)) return next();
    if (isPageRequest(request, pathname) && !PUBLIC_PAGES.has(pathname)) {
      const back = `${pathname}${new URL(request.url).search}`;
      return Response.redirect(`${appOrigin(request.url)}/?next=${encodeURIComponent(back)}`, 302);
    }
    return next();
  }

  if (isPublicApiPath(pathname)) return withWorkspace(LOCAL_WORKSPACE, () => next());
  try {
    assertAppAccess(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 401 });
  }
  const result = await withWorkspace(LOCAL_WORKSPACE, () => next());
  const token = readAppToken(request);
  const expected = process.env.LOOPABLE_APP_TOKEN;
  if (token && expected && token === expected && !isLoopbackHost(new URL(request.url).hostname)) {
    result.response.headers.append("Set-Cookie", appAccessCookie(token));
  }
  return result;
});

/**
 * Server functions are only ever called by the app's own pages, so a request
 * from another site is refused. Runners use the /api routes, which this skips.
 */
const sameOrigin = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [appAccess, sameOrigin],
}));
