import { defineAgentManifest } from "../define.ts";

export const claudeManifest = defineAgentManifest({
  id: "claude",
  name: "Claude Code",
  tagline: "Anthropic's coding agent, driven through its print mode.",
  docsUrl: "https://docs.claude.com/en/docs/claude-code/cli-reference",
  icon: "ClaudeCode",
  accent: "bg-[#d97757] text-white",
  binaries: ["claude"],
  installHint: "Install with curl -fsSL https://claude.ai/install.sh | bash, then run claude auth login.",
  permissionModes: ["read_only", "workspace_write"],
  supportsModel: true,
  modelPlaceholder: "e.g. sonnet or opus; leave empty for the default",
  defaults: { permissionMode: "read_only", model: null, timeoutMs: 300_000 },
});
