/**
 * Hosted Loopable shares a network database between the App Worker and the
 * Dispatcher. A local laptop still uses a file, and needs none of this.
 */
export function isHosted(): boolean {
  const url = process.env.LOOPABLE_DATABASE_URL ?? "";
  return url.startsWith("libsql:") || url.startsWith("https:") || url.startsWith("wss:");
}
