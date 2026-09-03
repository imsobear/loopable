import { defineAgentManifest } from "../define.ts";

export const codexManifest = defineAgentManifest({
  id: "codex",
  name: "Codex",
  tagline: "OpenAI's coding agent, driven non-interactively through codex exec.",
  docsUrl: "https://developers.openai.com/codex/cli",
  icon: "Terminal",
  accent: "bg-neutral-900 text-white",
  binaries: ["codex"],
  installHint: "Install with npm i -g @openai/codex, then run codex login.",
  permissionModes: ["read_only", "workspace_write"],
  supportsModel: true,
  modelPlaceholder: "leave empty for the Codex default",
  defaults: { permissionMode: "read_only", model: null, timeoutMs: 300_000 },
});
