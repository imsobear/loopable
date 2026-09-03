import { spawn } from "node:child_process";
import { clean } from "./discover.ts";

/**
 * Loopable's own credentials never reach an agent process. The agent keeps its
 * own model credentials, which is why this is a denylist rather than an
 * allowlist: CURSOR_API_KEY and friends have to survive.
 */
const WITHHELD = [/^GITHUB_/, /^GH_/, /^LOOPABLE_/];

export function agentEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (WITHHELD.some((pattern) => pattern.test(key))) continue;
    env[key] = value;
  }
  return env;
}

export type ProcessOutcome = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

/**
 * An agent that waits for input would otherwise hang a loop forever, so stdin
 * is closed immediately and the timeout is enforced by us rather than trusted
 * to the tool.
 */
export function runProcess(input: {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(input.bin, input.args, {
      cwd: input.cwd,
      env: agentEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const finish = (code: number | null, failure?: string) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: clean(stdout),
        stderr: clean(failure ? `${stderr}\n${failure}` : stderr),
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
  });
}
