import { isLoopbackHost } from "#/lib/callback.ts";
import {
  appAccessCookie,
  assertAppAccess,
  isPublicApiPath,
  readAppToken,
} from "#/server/access.ts";
import { createMiddleware, createStart } from "@tanstack/react-start";

const appAccess = createMiddleware({ type: "request" }).server(async ({ next, request, pathname }) => {
  if (isPublicApiPath(pathname)) return next();
  try {
    assertAppAccess(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 401 });
  }
  const result = await next();
  const token = readAppToken(request);
  const expected = process.env.LOOPABLE_APP_TOKEN;
  if (token && expected && token === expected && !isLoopbackHost(new URL(request.url).hostname)) {
    result.response.headers.append("Set-Cookie", appAccessCookie(token));
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [appAccess],
}));
