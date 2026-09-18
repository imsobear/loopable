import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fromSource = here.endsWith("/src");
const root = join(here, "..");
const node = process.execPath;

type Flags = {
  host: string;
  port: string;
  url?: string;
  token?: string;
};

function usage(): string {
  return `Usage:
  loopable start [--host 0.0.0.0] [--port 4321]
      App and Dispatcher (production build).

  loopable runner [--url URL] [--token TOKEN]
      Join this machine as a runner. URL and token also come from
      LOOPABLE_URL and LOOPABLE_RUNNER_TOKEN.

  loopable dispatcher
      Dispatcher only.

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
  const flags: Flags = {
    host: process.env.HOST ?? "0.0.0.0",
    port: process.env.PORT ?? "4321",
  };
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
    if (arg === "--host") flags.host = next();
    else if (arg === "--port") flags.port = next();
    else if (arg === "--url") flags.url = next();
    else if (arg === "--token") flags.token = next();
    else if (arg.startsWith("-")) fail(`Unknown flag: ${arg}`);
    else rest.push(arg);
  }
  return { command: rest[0] ?? "help", flags };
}

function prefixLines(label: string, stream: NodeJS.ReadableStream, write: (line: string) => void): void {
  createInterface({ input: stream }).on("line", (line) => write(`[${label}] ${line}\n`));
}

function run(label: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(file, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout) prefixLines(label, child.stdout, (line) => process.stdout.write(line));
  if (child.stderr) prefixLines(label, child.stderr, (line) => process.stderr.write(line));
  return child;
}

function stop(children: ChildProcess[]): void {
  for (const child of children) {
    if (child.pid && !child.killed) child.kill("SIGTERM");
  }
}

async function supervise(children: ChildProcess[]): Promise<void> {
  const shutdown = () => stop(children);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const code = await new Promise<number>((resolve) => {
    let settled = false;
    for (const child of children) {
      child.on("exit", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        stop(children);
        if (signal) resolve(0);
        else resolve(exitCode ?? 1);
      });
    }
  });
  process.exit(code);
}

function appEntry(): string {
  const entry = join(root, ".output/server/index.mjs");
  if (!existsSync(entry)) fail("App build missing. From a checkout run: pnpm build");
  return entry;
}

function pickEntry(kind: "dispatcher" | "runner"): string {
  const source = join(root, `src/${kind}/main.ts`);
  const bundled = join(root, `dist/${kind}.mjs`);
  if (fromSource && existsSync(source)) return source;
  if (existsSync(bundled)) return bundled;
  if (existsSync(source)) return source;
  fail(`${kind} build missing. From a checkout run: pnpm build`);
}

function nodeArgs(entry: string): string[] {
  return entry.endsWith(".ts") ? ["--experimental-strip-types", entry] : [entry];
}

function dispatcher(): ChildProcess {
  return run("dispatcher", node, nodeArgs(pickEntry("dispatcher")), {
    PORT: "",
    LOOPABLE_DISPATCHER_PORT: "",
  });
}

async function waitFor(child: ChildProcess): Promise<number> {
  return await new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => resolve(signal ? 0 : (code ?? 1)));
  });
}

async function waitForApp(port: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function printRunnerHint(flags: Flags): Promise<void> {
  await waitForApp(flags.port);
  const { lanIPv4 } = await import("./lib/lan.ts");
  const { getJoinToken } = await import("./server/runners.ts");
  const ip = lanIPv4() ?? "127.0.0.1";
  const url = `http://${ip}:${flags.port}`;
  let token = "<from Runners>";
  for (let i = 0; i < 40; i++) {
    try {
      token = await getJoinToken();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  process.stdout.write(
    `\nLoopable is at http://127.0.0.1:${flags.port}\n` +
      `Start a runner (this machine or another on the LAN):\n\n` +
      `  loopable runner --url ${url} --token ${token}\n\n` +
      `Connect GitHub from http://127.0.0.1:${flags.port} on this computer.\n\n`,
  );
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

  if (command === "runner") {
    if (flags.url) process.env.LOOPABLE_URL = flags.url;
    if (flags.token) process.env.LOOPABLE_RUNNER_TOKEN = flags.token;
    process.exit(
      await waitFor(
        spawn(node, nodeArgs(pickEntry("runner")), {
          cwd: root,
          env: process.env,
          stdio: "inherit",
        }),
      ),
    );
  }

  if (command === "dispatcher") {
    process.exit(
      await waitFor(
        spawn(node, nodeArgs(pickEntry("dispatcher")), {
          cwd: root,
          env: { ...process.env, PORT: "", LOOPABLE_DISPATCHER_PORT: "" },
          stdio: "inherit",
        }),
      ),
    );
  }

  if (command === "start") {
    const children = [
      run("app", node, [appEntry()], {
        PORT: flags.port,
        HOST: flags.host,
        NITRO_PORT: flags.port,
        NITRO_HOST: flags.host,
        LOOPABLE_SKIP_MIGRATE: "1",
      }),
      dispatcher(),
    ];
    void printRunnerHint(flags).catch((error) => {
      process.stderr.write(
        `Could not print runner hint: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
    await supervise(children);
    return;
  }

  fail(`Unknown command: ${command}\n\n${usage()}`);
}

await main();
