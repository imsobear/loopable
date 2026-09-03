import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const HOME_DIRS = [".local/bin", ".bun/bin", ".cargo/bin", ".volta/bin", ".deno/bin"];
const SYSTEM_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function inheritedDirs(): string[] {
  const home = homedir();
  return unique([
    ...(process.env.PATH ?? "").split(":"),
    ...HOME_DIRS.map((dir) => join(home, dir)),
    ...SYSTEM_DIRS,
  ]);
}

let loginDirs: string[] | null = null;

/**
 * A packaged app or a launchd job inherits a minimal PATH, so agents installed
 * under a shell-managed directory would look missing. Asking the login shell is
 * the fallback, and it only happens when the usual places come up empty.
 */
async function loginShellDirs(): Promise<string[]> {
  if (loginDirs) return loginDirs;
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const { stdout } = await exec(shell, ["-lc", 'printf %s "$PATH"'], { timeout: 5000 });
    loginDirs = unique(stdout.split(":"));
  } catch {
    loginDirs = [];
  }
  return loginDirs;
}

function executableIn(dirs: string[], names: string[]): string | null {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

export async function resolveBinary(names: string[]): Promise<string | null> {
  return executableIn(inheritedDirs(), names) ?? executableIn(await loginShellDirs(), names);
}

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

export function clean(text: string): string {
  return text.replace(ANSI, "").trim();
}

/** Runs a short informational command such as --version or a status check. */
export async function probe(
  bin: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ ok: boolean; text: string }> {
  try {
    const { stdout, stderr } = await exec(bin, args, { timeout: timeoutMs });
    return { ok: true, text: clean(stdout) || clean(stderr) };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      text: clean(failure.stdout ?? "") || clean(failure.stderr ?? "") || (failure.message ?? "failed"),
    };
  }
}

export function firstLine(text: string): string {
  return clean(text).split("\n")[0]?.trim() ?? "";
}
