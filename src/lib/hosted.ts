/**
 * Hosted Loopable shares a network database between the App Worker and the
 * Dispatcher. `pnpm dev` uses a file, and needs none of this.
 */
export function isHosted(): boolean {
  // Forces hosted behaviour on a file database, to try sign-in and workspaces locally.
  if (process.env.LOOPABLE_HOSTED === "1") return true;
  const url = process.env.LOOPABLE_DATABASE_URL ?? "";
  return url.startsWith("libsql:") || url.startsWith("https:") || url.startsWith("wss:");
}

/**
 * Only the front page is served, while Loopable becomes a desktop app: no
 * sign-in, no app, no dispatcher. Set on the Worker in wrangler.jsonc.
 */
export function isSiteOnly(): boolean {
  return process.env.LOOPABLE_SITE_ONLY === "1";
}
