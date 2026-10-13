import { describe, expect, it } from "vitest";
import { agentRuntime } from "./runtimes.ts";
import type { AgentRunInput, PermissionMode } from "./types.ts";

function input(permissionMode: PermissionMode, mcpServers?: string[]): AgentRunInput {
  return {
    prompt: "Check it.",
    cwd: "/tmp/work",
    settings: { permissionMode, model: null, timeoutMs: 60_000 },
    ...(mcpServers ? { mcpServers } : {}),
  };
}

const argsOf = (agent: string, given: AgentRunInput) => agentRuntime(agent).invocation(given).args;

describe("allowed MCP servers", () => {
  it("reach claude as rules naming each server, in either mode", () => {
    for (const mode of ["read_only", "workspace_write"] as const) {
      const args = argsOf("claude", input(mode, ["sentry", "sub2tok-admin"]));
      expect(args.join(" ")).toContain("--allowedTools mcp__sentry --allowedTools mcp__sub2tok-admin");
      // Still the last thing, so no variadic option swallows the prompt.
      expect(args.slice(-2)).toEqual(["--", "Check it."]);
    }
  });

  it("reach codex as servers whose tools are approved up front", () => {
    expect(argsOf("codex", input("read_only", ["sentry"]))).toContain(
      'mcp_servers.sentry.default_tools_approval_mode="approve"',
    );
  });

  it("have cursor start the servers nobody approved on this machine", () => {
    expect(argsOf("cursor-agent", input("read_only", ["sentry"]))).toContain("--approve-mcps");
  });

  it("change nothing when a loop allows none", () => {
    expect(argsOf("claude", input("read_only")).join(" ")).not.toContain("mcp__");
    expect(argsOf("codex", input("read_only")).join(" ")).not.toContain("mcp_servers");
    expect(argsOf("cursor-agent", input("read_only"))).not.toContain("--approve-mcps");
  });
});
