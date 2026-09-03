/**
 * The agent contract.
 *
 * Agents mirror connectors: a folder under src/agents with a client-safe
 * manifest.ts and a server-only runtime.ts. The difference is that agents are
 * discovered rather than connected, so nothing about them is stored except the
 * few settings a person chooses.
 *
 * An agent never receives Loopable's service credentials. It gets a workspace,
 * a prompt, and an environment with our tokens stripped out.
 */

export type AgentId = string;

/**
 * What the agent is allowed to do while it works. Every product spells this
 * differently, so the manifest declares which modes it can actually enforce
 * and the runtime translates.
 */
export type PermissionMode = "read_only" | "workspace_write";

export type AgentManifest = {
  id: AgentId;
  name: string;
  tagline: string;
  docsUrl?: string;
  /** Lucide icon name, resolved by the page. */
  icon: string;
  accent: string;
  /** Binary names to look for, in order of preference. */
  binaries: string[];
  /** Shown when the agent is not installed. */
  installHint: string;
  permissionModes: PermissionMode[];
  supportsModel: boolean;
  modelPlaceholder?: string;
  defaults: AgentSettingsValues;
};

export type AgentDetection =
  | { installed: true; binaryPath: string; version: string }
  | { installed: false };

/** Installed is not the same as usable, so this is checked separately. */
export type AgentAuthStatus = { signedIn: boolean; detail: string };

export type AgentSettingsValues = {
  permissionMode: PermissionMode;
  model: string | null;
  timeoutMs: number;
};

export type AgentRunInput = {
  prompt: string;
  cwd: string;
  settings: AgentSettingsValues;
  /** Where the agent should write its final message, when it supports that. */
  outputFile?: string;
};

export type AgentInvocation = { bin: string; args: string[] };

export type AgentRunResult = {
  ok: boolean;
  /** The agent's final message, or as close to it as the product allows. */
  output: string;
  detail?: string;
  durationMs: number;
  /** Exactly what ran, for the audit trail. */
  command: string;
};

export type AgentRuntime = {
  detect(): Promise<AgentDetection>;
  authStatus(): Promise<AgentAuthStatus>;
  /** What would run. Used for the command preview and the audit trail. */
  invocation(input: AgentRunInput): AgentInvocation;
  run(input: AgentRunInput): Promise<AgentRunResult>;
};

export type Agent = { manifest: AgentManifest; runtime: AgentRuntime };
