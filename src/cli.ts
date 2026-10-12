import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

type Flags = { url?: string; token?: string };

function usage(): string {
  return `Usage:
  loopable runner --token TOKEN [--url URL]
      Connect this machine to your workspace and run agents for it. The token
      is on the Runners page. It is remembered here, so next time it is just
      loopable runner.

  loopable logout
      Forget the workspace this machine was connected to.

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
    else if (arg.startsWith("-")) fail(`Unknown flag: ${arg}`);
    else rest.push(arg);
  }
  return { command: rest[0] ?? "help", flags };
}

/** What the first `loopable runner --token` saved: where your workspace is and how to join it. */
type Saved = { url: string; joinToken: string };

function savedPath(): string {
  return join(process.env.LOOPABLE_HOME ?? join(homedir(), ".loopable"), "runner.json");
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
  const child = spawn(node, entry.endsWith(".ts") ? ["--experimental-strip-types", entry] : [entry], {
    cwd: root,
    env: { ...process.env, LOOPABLE_URL: url, LOOPABLE_RUNNER_TOKEN: token },
    stdio: "inherit",
  });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return await new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => resolve(signal ? 0 : (code ?? 1)));
  });
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
  if (command === "logout") {
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
