import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The loopable command. Loopable itself is hosted; what runs on your machine
 * is a runner, which takes jobs from your workspace and runs your coding agent
 * here, with your code, your tools and your logins.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fromSource = here.endsWith("/src");
const root = join(here, "..");
const node = process.execPath;

const DEFAULT_URL = "https://loop.goodone.si";

type Flags = { url?: string; token?: string; foreground?: boolean; follow?: boolean };

function usage(): string {
  return `Usage:
  loopable runner --token TOKEN [--url URL] [--foreground]
      Connect this machine to your workspace and start the runner in the
      background. The token is on the Runners page and is remembered here, so
      next time it is just loopable runner. --foreground keeps it attached to
      this terminal, for a server or a container.

  loopable status
      Whether the runner is running, and where its log is.

  loopable logs [-f]
      Show the runner's log. -f keeps following it.

  loopable stop
      Stop the runner.

  loopable logout
      Stop the runner and forget the workspace this machine was connected to.

  loopable --version
`;
}

function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parse(argv: string[]): { command: string; flags: Flags } {
  const flags: Flags = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (!value) fail(`${arg} needs a value.`);
      return value;
    };
    if (arg === "-h" || arg === "--help") return { command: "help", flags };
    if (arg === "-v" || arg === "--version") return { command: "version", flags };
    if (arg === "--url") flags.url = next();
    else if (arg === "--token") flags.token = next();
    else if (arg === "--foreground") flags.foreground = true;
    else if (arg === "-f" || arg === "--follow") flags.follow = true;
    else if (arg.startsWith("-")) fail(`Unknown flag: ${arg}`);
    else rest.push(arg);
  }
  return { command: rest[0] ?? "help", flags };
}

/** What the first `loopable runner --token` saved: where your workspace is and how to join it. */
type Saved = { url: string; joinToken: string };

function home(): string {
  return process.env.LOOPABLE_HOME ?? join(homedir(), ".loopable");
}

function savedPath(): string {
  return join(home(), "runner.json");
}

const pidPath = () => join(home(), "runner.pid");
const logPath = () => join(home(), "runner.log");

/** The background runner's pid, if one is still alive. */
function runningPid(): number | null {
  if (!existsSync(pidPath())) return null;
  const pid = Number(readFileSync(pidPath(), "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    rmSync(pidPath(), { force: true });
    return null;
  }
}

function tail(path: string, lines: number): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

function readSaved(): Saved | null {
  const path = savedPath();
  if (!existsSync(path)) return null;
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as Saved;
    return saved.url && saved.joinToken ? saved : null;
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved): void {
  const path = savedPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  // The join token is a credential: only you can read this file.
  chmodSync(path, 0o600);
}

function runnerEntry(): string {
  const source = join(root, "src/runner/main.ts");
  const bundled = join(root, "dist/runner.mjs");
  if (fromSource && existsSync(source)) return source;
  if (existsSync(bundled)) return bundled;
  if (existsSync(source)) return source;
  fail("Runner build missing. From a checkout run: pnpm build");
}

async function runner(flags: Flags): Promise<number> {
  const saved = readSaved();
  const url = (flags.url ?? process.env.LOOPABLE_URL ?? saved?.url ?? DEFAULT_URL).replace(/\/$/, "");
  const token = flags.token ?? process.env.LOOPABLE_RUNNER_TOKEN ?? saved?.joinToken;
  if (!token) {
    fail(
      `This machine is not connected yet. Copy the command from the Runners page at ${url}/runners:\n\n` +
        "  loopable runner --token TOKEN",
    );
  }
  // A token given on the command line is remembered, so the next start is
  // just loopable runner. One from the environment is left where it is.
  if (flags.token) writeSaved({ url, joinToken: flags.token });

  const entry = runnerEntry();
  const args = entry.endsWith(".ts") ? ["--experimental-strip-types", entry] : [entry];
  const env = { ...process.env, LOOPABLE_URL: url, LOOPABLE_RUNNER_TOKEN: token };

  if (flags.foreground) {
    const child = spawn(node, args, { cwd: root, env, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return await new Promise<number>((resolve) => {
      child.on("exit", (code, signal) => resolve(signal ? 0 : (code ?? 1)));
    });
  }

  const already = runningPid();
  if (already) {
    process.stdout.write(`The runner is already running (pid ${already}). Restart it with: loopable stop && loopable runner\n`);
    return 0;
  }
  return await startInBackground(args, env);
}

/**
 * Detached into its own session, so closing the terminal does not take it
 * down. Waits until it has joined, so a wrong token is said here, not later
 * in a log nobody is reading.
 */
async function startInBackground(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  mkdirSync(home(), { recursive: true });
  // Started over once it is large, so it never grows without end.
  const tooBig = existsSync(logPath()) && statSync(logPath()).size > 5_000_000;
  const log = openSync(logPath(), tooBig ? "w" : "a");
  const startedAt = tooBig ? 0 : statSync(logPath()).size;
  // Told where its pid lives, so after updating itself the new runner is the one stop stops.
  const child = spawn(node, args, {
    cwd: root,
    env: { ...env, LOOPABLE_RUNNER_PIDFILE: pidPath() },
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  if (!child.pid) fail("Could not start the runner.");
  writeFileSync(pidPath(), `${child.pid}\n`);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const fresh = readFileSync(logPath()).subarray(startedAt).toString("utf8");
    const joined = /joined as (.+)/.exec(fresh);
    if (joined) {
      process.stdout.write(
        `Runner started in the background, ${joined[1]}.\n` +
          `  It keeps running after you close this terminal.\n` +
          `  loopable status   loopable logs   loopable stop\n`,
      );
      return 0;
    }
    if (!runningPid()) {
      process.stderr.write(`The runner stopped before it joined:\n\n${fresh.trimEnd() || tail(logPath(), 20)}\n`);
      return 1;
    }
  }
  process.stdout.write(
    `The runner is starting in the background but has not joined yet. Check on it with: loopable logs\n`,
  );
  return 0;
}

async function stopRunner(quiet = false): Promise<void> {
  const pid = runningPid();
  if (!pid) {
    if (!quiet) process.stdout.write("The runner is not running.\n");
    return;
  }
  process.kill(pid, "SIGTERM");
  // It stops the agent it is running first, so give it a moment.
  for (let i = 0; i < 50 && runningPid(); i++) await new Promise((resolve) => setTimeout(resolve, 200));
  if (runningPid()) process.kill(pid, "SIGKILL");
  rmSync(pidPath(), { force: true });
  if (!quiet) process.stdout.write(`Stopped the runner (pid ${pid}).\n`);
}

function status(): void {
  const pid = runningPid();
  const saved = readSaved();
  if (!saved) {
    process.stdout.write("Not connected. Run the command from the Runners page: loopable runner --token TOKEN\n");
    return;
  }
  process.stdout.write(
    `${pid ? `Running (pid ${pid})` : "Not running. Start it with: loopable runner"}\n` +
      `  Workspace at ${saved.url}\n  Log: ${logPath()}\n`,
  );
}

async function logs(flags: Flags): Promise<void> {
  if (!existsSync(logPath())) {
    process.stdout.write("No log yet. Start the runner with: loopable runner\n");
    return;
  }
  if (!flags.follow) {
    process.stdout.write(`${tail(logPath(), 100)}\n`);
    return;
  }
  const child = spawn("tail", ["-n", "100", "-f", logPath()], { stdio: "inherit" });
  await new Promise((resolve) => child.on("exit", resolve));
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));

  if (command === "help") {
    process.stdout.write(usage());
    return;
  }
  if (command === "version") {
    process.stdout.write(`${cliVersion()}\n`);
    return;
  }
  if (command === "login") {
    fail("Connect with the token from the Runners page instead:\n\n  loopable runner --token TOKEN");
  }
  if (command === "runner") {
    process.exit(await runner(flags));
  }
  if (command === "stop") {
    await stopRunner();
    return;
  }
  if (command === "status") {
    status();
    return;
  }
  if (command === "logs") {
    await logs(flags);
    return;
  }
  if (command === "logout") {
    await stopRunner(true);
    const path = savedPath();
    if (existsSync(path)) rmSync(path);
    process.stdout.write("This machine is no longer connected to a workspace.\n");
    return;
  }
  if (command === "start" || command === "dispatcher") {
    fail(
      `Loopable is hosted now, at ${DEFAULT_URL}, so there is nothing to start here.\n` +
        "Sign in there, then connect this machine with the command on the Runners page.",
    );
  }

  fail(`Unknown command: ${command}\n\n${usage()}`);
}

await main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
