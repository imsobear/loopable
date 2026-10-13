import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Whether this runner came from `npm install -g loopable-cli`, and so can
 * update itself the same way. One run from a checkout is updated by hand.
 */
export function isUpdatable(entry = process.argv[1] ?? ""): boolean {
  return /[\\/]node_modules[\\/]loopable-cli[\\/]/.test(entry);
}

/** Installs a version over this one. Returns what went wrong, or null. */
export function install(version: string): string | null {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["install", "-g", `loopable-cli@${version}`], {
    // Not from inside the package npm is about to replace.
    cwd: homedir(),
    encoding: "utf8",
    timeout: 5 * 60_000,
  });
  if (result.error) return result.error.message;
  if (result.status === 0) return null;
  const said = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim().split("\n");
  // npm's own last lines say why, such as a permission it does not have.
  return said.filter((line) => /ERR|error/i.test(line)).slice(-3).join(" ") || `npm exited with ${result.status}`;
}

/**
 * Starts the newly installed runner in this one's place. In the background
 * it is detached and recorded as the runner `loopable stop` stops; in the
 * foreground it runs as this process's child, so a service manager still sees
 * one process.
 */
export function restart(): void {
  const entry = process.argv[1]!;
  const pidFile = process.env.LOOPABLE_RUNNER_PIDFILE;
  if (pidFile) {
    const child = spawn(process.execPath, [entry], {
      cwd: homedir(),
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.unref();
    if (child.pid) writeFileSync(pidFile, `${child.pid}\n`);
    process.exit(0);
  }
  const child = spawn(process.execPath, [entry], { cwd: homedir(), stdio: "inherit", env: process.env });
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}
