import { readFileSync, rmSync } from "node:fs";
import { defineAgentRuntime } from "../define.ts";
import { firstLine, probe, resolveBinary } from "../discover.ts";
import { runProcess } from "../process.ts";
import type { AgentInvocation, AgentRunInput } from "../types.ts";
import { codexManifest } from "./manifest.ts";

async function binary(): Promise<string> {
  const found = await resolveBinary(codexManifest.binaries);
  if (!found) throw new Error("The codex binary was not found on this host.");
  return found;
}

function args(input: AgentRunInput): string[] {
  const list = [
    "exec",
    "--sandbox",
    input.settings.permissionMode === "read_only" ? "read-only" : "workspace-write",
    // The workspace is a scratch directory rather than a checkout, and session
    // files would outlive a run that is meant to leave nothing behind.
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-C",
    input.cwd,
  ];
  if (input.settings.model) list.push("-m", input.settings.model);
  if (input.outputFile) list.push("-o", input.outputFile);
  list.push(input.prompt);
  return list;
}

export const codexRuntime = defineAgentRuntime({
  async detect() {
    const found = await resolveBinary(codexManifest.binaries);
    if (!found) return { installed: false };
    const version = await probe(found, ["--version"]);
    return { installed: true, binaryPath: found, version: firstLine(version.text) };
  },

  async authStatus() {
    const found = await resolveBinary(codexManifest.binaries);
    if (!found) return { signedIn: false, detail: "Not installed." };
    const result = await probe(found, ["login", "status"]);
    return {
      signedIn: result.ok,
      detail: firstLine(result.text) || (result.ok ? "Signed in." : "Run codex login."),
    };
  },

  invocation(input): AgentInvocation {
    return { bin: codexManifest.binaries[0]!, args: args(input) };
  },

  async run(input) {
    const bin = await binary();
    const argv = args(input);
    const command = `${bin} ${argv.join(" ")}`;
    const outcome = await runProcess({
      bin,
      args: argv,
      cwd: input.cwd,
      timeoutMs: input.settings.timeoutMs,
      signal: input.signal,
      logPath: input.logFile,
    });

    // --output-last-message isolates the final answer; stdout also carries the
    // session preamble, which is only useful when something went wrong.
    let output = "";
    if (input.outputFile) {
      try {
        output = readFileSync(input.outputFile, "utf8").trim();
        rmSync(input.outputFile, { force: true });
      } catch {
        output = "";
      }
    }
    if (!output) output = outcome.stdout;

    if (outcome.aborted) {
      return { ok: false, aborted: true, output, durationMs: outcome.durationMs, command };
    }
    if (outcome.timedOut) {
      return {
        ok: false,
        output,
        detail: `Codex did not finish within ${Math.round(input.settings.timeoutMs / 1000)}s.`,
        durationMs: outcome.durationMs,
        command,
      };
    }
    return {
      ok: outcome.code === 0,
      output,
      detail: outcome.code === 0 ? undefined : outcome.stderr || `Exited with code ${outcome.code}.`,
      durationMs: outcome.durationMs,
      command,
    };
  },
});
