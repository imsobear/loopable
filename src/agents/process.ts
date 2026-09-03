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

/**
 * A negative pid means the process group. Failing is normal here: the group
 * is usually already gone, which is exactly what we wanted.
 */
function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

export type ProcessOutcome = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Stopped from outside: a person pressed Stop, or Loopable is shutting down. */
  aborted: boolean;
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
  signal?: AbortSignal;
}): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();

    if (input.signal?.aborted) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, aborted: true, durationMs: 0 });
      return;
    }

    const child = spawn(input.bin, input.args, {
      cwd: input.cwd,
      env: agentEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so it can be stopped as a family. Agent CLIs
      // start helpers of their own, and signalling only the process we
      // launched leaves those behind, reparented to init and still working.
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;

    /** Ask the whole group first, insist shortly after. */
    const halt = () => {
      signalGroup(child.pid, "SIGTERM");
      setTimeout(() => signalGroup(child.pid, "SIGKILL"), 3000).unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      halt();
    }, input.timeoutMs);

    const onAbort = () => {
      aborted = true;
      halt();
    };
    input.signal?.addEventListener("abort", onAbort);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const finish = (code: number | null, failure?: string) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout: clean(stdout),
        stderr: clean(failure ? `${stderr}\n${failure}` : stderr),
        timedOut,
        aborted,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
  });
}
