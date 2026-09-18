import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

process.env.LOOPABLE_DEV = "1";

const root = fileURLToPath(new URL("..", import.meta.url));
const node = process.execPath;
const vite = join(root, "node_modules/.bin/vite");
const port = process.env.PORT ?? "4321";
const host = process.env.HOST ?? "127.0.0.1";
const appUrl = `http://127.0.0.1:${port}`;

function run(file: string, args: string[], extra: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(file, args, {
    cwd: root,
    env: { ...process.env, ...extra },
    stdio: "inherit",
  });
}

const app = run(vite, ["dev", "--port", port, "--host", host], { LOOPABLE_DEV: "1" });
const dispatcher = run(node, ["--experimental-strip-types", join(root, "src/dispatcher/main.ts")], {
  PORT: "",
  LOOPABLE_DISPATCHER_PORT: "",
  LOOPABLE_DEV: "1",
});
let runner: ChildProcess | undefined;

function stop() {
  if (runner && !runner.killed) runner.kill("SIGTERM");
  if (!app.killed) app.kill("SIGTERM");
  if (!dispatcher.killed) dispatcher.kill("SIGTERM");
}

let settled = false;
function finish(code: number) {
  if (settled) return;
  settled = true;
  stop();
  process.exit(code);
}

process.on("SIGINT", () => finish(0));
process.on("SIGTERM", () => finish(0));
app.on("exit", (code) => finish(code ?? 1));
dispatcher.on("exit", (code) => finish(code ?? 1));

async function waitForApp(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(appUrl, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  process.stderr.write(`App did not start at ${appUrl}\n`);
  finish(1);
}

const { getJoinToken } = await import("../src/server/runners.ts");
await waitForApp();
const joinToken = await getJoinToken();
runner = run(node, ["--experimental-strip-types", join(root, "src/runner/main.ts")], {
  LOOPABLE_DEV: "1",
  LOOPABLE_URL: appUrl,
  LOOPABLE_RUNNER_TOKEN: joinToken,
});
runner.on("exit", (code) => finish(code ?? 1));
