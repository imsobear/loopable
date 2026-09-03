import { defineAgentRuntime } from "../define.ts";
import { firstLine, probe, resolveBinary } from "../discover.ts";
import { runProcess } from "../process.ts";
import type { AgentInvocation, AgentRunInput } from "../types.ts";
import { cursorAgentManifest } from "./manifest.ts";

async function binary(): Promise<string> {
  const found = await resolveBinary(cursorAgentManifest.binaries);
  if (!found) throw new Error("The cursor-agent binary was not found on this machine.");
  return found;
}

function args(input: AgentRunInput): string[] {
  const list = [
    "-p",
    "--output-format",
    "text",
    "--workspace",
    input.cwd,
    // Without this the agent stops to ask whether the workspace is trusted,
    // and in print mode there is nobody to answer.
    "--trust",
  ];
  if (input.settings.permissionMode === "read_only") {
    // Print mode otherwise has write and shell access.
    list.push("--mode", "ask");
  } else {
    list.push("--force");
  }
  if (input.settings.model) list.push("--model", input.settings.model);
  list.push(input.prompt);
  return list;
}

export const cursorAgentRuntime = defineAgentRuntime({
  async detect() {
    const found = await resolveBinary(cursorAgentManifest.binaries);
    if (!found) return { installed: false };
    const version = await probe(found, ["--version"]);
    return { installed: true, binaryPath: found, version: firstLine(version.text) };
  },

  async authStatus() {
    const found = await resolveBinary(cursorAgentManifest.binaries);
    if (!found) return { signedIn: false, detail: "Not installed." };
    const result = await probe(found, ["status"]);
    const detail = firstLine(result.text);
    return {
      signedIn: result.ok && !/not logged in|logged out/i.test(detail),
      detail: detail || (result.ok ? "Signed in." : "Run cursor-agent login."),
    };
  },

  invocation(input): AgentInvocation {
    return { bin: cursorAgentManifest.binaries[0]!, args: args(input) };
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
    });
    const command = `${bin} ${argv.join(" ")}`;

    if (outcome.aborted) {
      return { ok: false, aborted: true, output: outcome.stdout, durationMs: outcome.durationMs, command };
    }
    if (outcome.timedOut) {
      return {
        ok: false,
        output: outcome.stdout,
        detail: `Cursor Agent did not finish within ${Math.round(input.settings.timeoutMs / 1000)}s.`,
        durationMs: outcome.durationMs,
        command,
      };
    }
    return {
      ok: outcome.code === 0,
      output: outcome.stdout,
      detail: outcome.code === 0 ? undefined : outcome.stderr || `Exited with code ${outcome.code}.`,
      durationMs: outcome.durationMs,
      command,
    };
  },
});
