import { isLoopbackHost } from "#/lib/callback.ts";

export const APP_ACCESS_COOKIE = "loopable_access";

export function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function readAppToken(request: Request): string | null {
  const fromBearer = bearer(request);
  if (fromBearer) return fromBearer;
  const fromQuery = new URL(request.url).searchParams.get("token")?.trim();
  if (fromQuery) return fromQuery;
  return cookieValue(request.headers.get("cookie"), APP_ACCESS_COOKIE);
}

export function appAccessCookie(token: string): string {
  const secure = process.env.LOOPABLE_BASE_URL?.startsWith("https:") ? "; Secure" : "";
  return `${APP_ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * Loopback stays open. Anything else needs LOOPABLE_APP_TOKEN, or the UI is
 * on the network with no door.
 */
export function assertAppAccess(request: Request): void {
  if (isLoopbackHost(new URL(request.url).hostname)) return;
  const expected = process.env.LOOPABLE_APP_TOKEN;
  if (!expected) {
    throw new Error("Set LOOPABLE_APP_TOKEN before exposing Loopable off loopback.");
  }
  if (readAppToken(request) !== expected) {
    throw new Error("This Loopable is not open to you.");
  }
}

/** Runner pull and OAuth callbacks have their own tokens. */
export function isPublicApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/runners/") || pathname.startsWith("/api/connectors/");
}
