import { defineAgentManifest } from "../define.ts";

export const cursorAgentManifest = defineAgentManifest({
  id: "cursor-agent",
  name: "Cursor Agent",
  tagline: "Cursor's CLI agent, driven through its print mode.",
  docsUrl: "https://cursor.com/docs/cli",
  icon: "MousePointerClick",
  accent: "bg-blue-600 text-white",
  binaries: ["cursor-agent"],
  installHint: "Install with curl https://cursor.com/install -fsS | bash, then run cursor-agent login.",
  permissionModes: ["read_only", "workspace_write"],
  supportsModel: true,
  modelPlaceholder: "e.g. gpt-5 or sonnet-4.5",
  defaults: { permissionMode: "read_only", model: null, timeoutMs: 300_000 },
});
