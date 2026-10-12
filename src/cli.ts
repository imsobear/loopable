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
  loopable login [--url URL]
      Connect this machine to your Loopable workspace. Opens the browser to
      approve it, then remembers it here.

  loopable runner [--url URL] [--token TOKEN]
      Run agents for your workspace on this machine. Uses what login saved,
      or a join token from the Runners page.

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

/** What `loopable login` saved: where your workspace is and how to join it. */
type Saved = { url: string; joinToken: string; workspace?: string };

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

function baseUrl(flags: Flags): string {
  return (flags.url ?? process.env.LOOPABLE_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

/** Best effort: if no browser opens, the link is printed anyway. */
function openBrowser(url: string): void {
  if (process.env.LOOPABLE_NO_BROWSER === "1") return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // printed above; nothing more to do
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${url} answered ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error((parsed as { error?: string }).error ?? `${url} answered ${res.status}`);
  return parsed as T;
}

async function login(flags: Flags): Promise<void> {
  const url = baseUrl(flags);
  const started = await post<{ code: string; pollSecret: string; expiresInMs: number; url: string }>(
    `${url}/api/runners/login/start`,
    {},
  );
  process.stdout.write(
    `\nTo connect this machine, open:\n\n  ${started.url}\n\nand check it shows this code:\n\n  ${started.code}\n\n`,
  );
  openBrowser(started.url);

  const deadline = Date.now() + started.expiresInMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const answer = await post<{ state: string; joinToken?: string; workspace?: string }>(
      `${url}/api/runners/login/poll`,
      { code: started.code, pollSecret: started.pollSecret },
    );
    if (answer.state === "approved" && answer.joinToken) {
      writeSaved({ url, joinToken: answer.joinToken, workspace: answer.workspace });
      process.stdout.write(
        `Connected to ${answer.workspace ?? "your workspace"}. Start the runner with:\n\n  loopable runner\n\n`,
      );
      return;
    }
    if (answer.state === "expired") fail("The code expired before it was approved. Run loopable login again.");
  }
  fail("The code expired before it was approved. Run loopable login again.");
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
  const url = flags.url ?? process.env.LOOPABLE_URL ?? saved?.url;
  const token = flags.token ?? process.env.LOOPABLE_RUNNER_TOKEN ?? saved?.joinToken;
  if (!url || !token) fail("This machine is not connected yet. Run loopable login first.");

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
    await login(flags);
    return;
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
        `Sign in there, then connect this machine with: loopable login`,
    );
  }

  fail(`Unknown command: ${command}\n\n${usage()}`);
}

await main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
