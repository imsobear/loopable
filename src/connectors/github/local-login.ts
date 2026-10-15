import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * The GitHub CLI's login on this machine, which the desktop app connects
 * GitHub with: nothing to register, nothing to type, and the account is the
 * one this machine's git already works as. Only ever read in the desktop
 * app, whose engine runs as the person; the hosted service has no such
 * thing and must never look.
 */
export function canUseLocalLogin(): boolean {
  return process.env.LOOPABLE_DESKTOP === "1";
}

const KEEP_MS = 5 * 60_000;
let cached: { token: string | null; at: number } | null = null;

type Run = (bin: string, args: string[]) => Promise<{ stdout: string }>;
const run: Run = (bin, args) => exec(bin, args, { timeout: 10_000 });

/**
 * The CLI's current token, or null when it is not installed or signed in.
 * Asked again every few minutes, so signing in again with gh is picked up.
 */
export async function localToken(options: { fresh?: boolean; runner?: Run } = {}): Promise<string | null> {
  if (!canUseLocalLogin()) return null;
  if (!options.fresh && cached && Date.now() - cached.at < KEEP_MS) return cached.token;
  let token: string | null = null;
  try {
    const { stdout } = await (options.runner ?? run)("gh", ["auth", "token", "--hostname", "github.com"]);
    token = stdout.trim() || null;
  } catch {
    token = null;
  }
  cached = { token, at: Date.now() };
  return token;
}

export function forgetLocalToken(): void {
  cached = null;
}
