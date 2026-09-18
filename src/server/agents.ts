import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { AGENT_MANIFESTS, agentManifest } from "#/agents/manifests.ts";
import { agentRuntime } from "#/agents/runtimes.ts";
import type { AgentRunResult, AgentSettingsValues } from "#/agents/types.ts";
import type { AgentView } from "#/lib/domain.ts";
import { isHosted } from "#/lib/hosted.ts";
import { db } from "./db/client.ts";
import { agentSettings, appSettings } from "./db/schema.ts";

const DEFAULT_AGENT_KEY = "defaultAgentId";

async function storedSetting(key: string): Promise<string | null> {
  const row = await db().select().from(appSettings).where(eq(appSettings.key, key)).get();
  return typeof row?.value === "string" ? row.value : null;
}

export async function settingsFor(agentId: string): Promise<AgentSettingsValues> {
  const manifest = agentManifest(agentId);
  if (!manifest) throw new Error(`Unknown agent: ${agentId}`);
  const row = await db().select().from(agentSettings).where(eq(agentSettings.agentId, agentId)).get();
  if (!row) return manifest.defaults;
  return { permissionMode: row.permissionMode, model: row.model, timeoutMs: row.timeoutMs };
}

/**
 * Detection, authorization state and settings for every known agent. Detection
 * runs on every call because installing or removing a CLI should show up
 * without anyone pressing refresh.
 */
export async function listAgents(): Promise<AgentView[]> {
  const chosen = await storedSetting(DEFAULT_AGENT_KEY);
  const hosted = isHosted();

  const views = await Promise.all(
    AGENT_MANIFESTS.map(async (manifest) => {
      const runtime = agentRuntime(manifest.id);
      const settings = await settingsFor(manifest.id);
      const preview = runtime.invocation({
        prompt: "<prompt>",
        cwd: "<workspace>",
        settings,
      });
      if (hosted) {
        return {
          agentId: manifest.id,
          installed: false,
          binaryPath: "",
          version: null,
          auth: null,
          settings,
          isDefault: false,
          defaultIsImplicit: false,
          commandPreview: `${preview.bin} ${preview.args.join(" ")}`,
          onRunners: [],
        } satisfies AgentView;
      }

      const detection = await runtime.detect();
      const auth = detection.installed ? await runtime.authStatus() : null;
      return {
        agentId: manifest.id,
        installed: detection.installed,
        binaryPath: detection.installed ? detection.binaryPath : null,
        version: detection.installed ? detection.version : null,
        auth,
        settings,
        isDefault: false,
        defaultIsImplicit: false,
        commandPreview: `${preview.bin} ${preview.args.join(" ")}`,
        onRunners: [],
      } satisfies AgentView;
    }),
  );

  return views.map((view) =>
    view.agentId === chosen ? { ...view, isDefault: true, defaultIsImplicit: false } : view,
  );
}

export async function saveAgentSettings(agentId: string, values: AgentSettingsValues): Promise<void> {
  const manifest = agentManifest(agentId);
  if (!manifest) throw new Error(`Unknown agent: ${agentId}`);
  if (!manifest.permissionModes.includes(values.permissionMode)) {
    throw new Error(`${manifest.name} cannot run in ${values.permissionMode} mode.`);
  }
  if (values.timeoutMs < 10_000 || values.timeoutMs > 3_600_000) {
    throw new Error("The timeout must be between 10 seconds and one hour.");
  }
  const model = values.model?.trim() ? values.model.trim() : null;
  await db()
    .insert(agentSettings)
    .values({ agentId, permissionMode: values.permissionMode, model, timeoutMs: values.timeoutMs })
    .onConflictDoUpdate({
      target: agentSettings.agentId,
      set: {
        permissionMode: values.permissionMode,
        model,
        timeoutMs: values.timeoutMs,
        updatedAt: new Date(),
      },
    })
    .run();
}

export async function setDefaultAgent(agentId: string): Promise<void> {
  if (!agentManifest(agentId)) throw new Error(`Unknown agent: ${agentId}`);
  await db()
    .insert(appSettings)
    .values({ key: DEFAULT_AGENT_KEY, value: agentId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: agentId, updatedAt: new Date() },
    })
    .run();
}

const TEST_WORD = "loopable-ok";

/**
 * A real run, because a version check cannot tell you whether the agent can
 * reach a model. It stays deliberately tiny: read one file, say one word.
 */
export async function testAgent(agentId: string): Promise<AgentRunResult & { passed: boolean }> {
  if (isHosted()) throw new Error("Test an agent on a runner.");
  const runtime = agentRuntime(agentId);
  const settings = await settingsFor(agentId);
  const cwd = mkdtempSync(join(tmpdir(), "loopable-agent-test-"));
  writeFileSync(join(cwd, "NOTE.md"), `${TEST_WORD}\n`);

  const result = await runtime.run({
    prompt: "Read NOTE.md in your working directory and reply with only the word it contains.",
    cwd,
    outputFile: join(cwd, "last-message.txt"),
    settings: { ...settings, timeoutMs: Math.min(settings.timeoutMs, 120_000) },
  });
  return { ...result, passed: result.ok && result.output.includes(TEST_WORD) };
}
