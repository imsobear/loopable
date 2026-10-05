import { defineAgentRuntime } from "../define.ts";
import { firstLine, probe, resolveBinary } from "../discover.ts";
import { runProcess } from "../process.ts";
import type { AgentInvocation, AgentRunInput } from "../types.ts";
import { answerFrom, describeEvent } from "./events.ts";
import { claudeManifest } from "./manifest.ts";

async function binary(): Promise<string> {
  const found = await resolveBinary(claudeManifest.binaries);
  if (!found) throw new Error("The claude binary was not found on this host.");
  return found;
}

function args(input: AgentRunInput): string[] {
  const list = [
    "-p",
    // A stream of events rather than one block at the end, so a run can be
    // watched. Print mode refuses stream-json without --verbose.
    "--output-format",
    "stream-json",
    "--verbose",
    // Session files would outlive a run that is meant to leave nothing behind.
    "--no-session-persistence",
  ];
  if (input.settings.permissionMode === "read_only") {
    // Only tools that look. dontAsk denies anything else instead of waiting
    // for an answer nobody is there to give.
    list.push("--permission-mode", "dontAsk", "--tools", "Read,Grep,Glob");
  } else {
    // Edits inside the workspace and any shell command. bypassPermissions
    // would be the closer match, but claude refuses it when run as root,
    // which is how the container runs.
    list.push("--permission-mode", "acceptEdits", "--allowedTools", "Bash");
  }
  if (input.settings.model) list.push("--model", input.settings.model);
  // The prompt follows a variadic option, so it has to be marked as the
  // positional argument or --allowedTools would swallow it.
  list.push("--", input.prompt);
  return list;
}

export const claudeRuntime = defineAgentRuntime({
  async detect() {
    const found = await resolveBinary(claudeManifest.binaries);
    if (!found) return { installed: false };
    const version = await probe(found, ["--version"]);
    return { installed: true, binaryPath: found, version: firstLine(version.text) };
  },

  async authStatus() {
    const found = await resolveBinary(claudeManifest.binaries);
    if (!found) return { signedIn: false, detail: "Not installed." };
    // Exits non-zero when signed out, and prints JSON either way.
    const result = await probe(found, ["auth", "status", "--json"]);
    try {
      const status = JSON.parse(result.text) as { loggedIn?: boolean; authMethod?: string };
      return status.loggedIn
        ? { signedIn: true, detail: `Signed in (${status.authMethod ?? "unknown method"}).` }
        : { signedIn: false, detail: "Run claude auth login." };
    } catch {
      return {
        signedIn: result.ok,
        detail: firstLine(result.text) || (result.ok ? "Signed in." : "Run claude auth login."),
      };
    }
  },

  invocation(input): AgentInvocation {
    return { bin: claudeManifest.binaries[0]!, args: args(input) };
  },

  async run(input) {
    const bin = await binary();
    const argv = args(input);
    const outcome = await runProcess({
      bin,
      args: argv,
      cwd: input.cwd,
      timeoutMs: input.settings.timeoutMs,
      signal: input.signal,
      logPath: input.logFile,
      logLine: (line) => describeEvent(line, input.cwd),
    });
    const command = `${bin} ${argv.join(" ")}`;
    const answer = answerFrom(outcome.stdout);

    if (outcome.aborted) {
      return { ok: false, aborted: true, output: answer.text, durationMs: outcome.durationMs, command };
    }
    if (outcome.timedOut) {
      return {
        ok: false,
        output: answer.text,
        detail: `Claude Code did not finish within ${Math.round(input.settings.timeoutMs / 1000)}s.`,
        durationMs: outcome.durationMs,
        command,
      };
    }
    return {
      ok: outcome.code === 0 && !answer.failed,
      output: answer.text,
      detail:
        outcome.code === 0 && !answer.failed
          ? undefined
          : answer.failed
            ? answer.text || "The agent reported an error."
            : outcome.stderr || `Exited with code ${outcome.code}.`,
      durationMs: outcome.durationMs,
      command,
    };
  },
});
