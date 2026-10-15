import { randomBytes } from "node:crypto";
import { toDataURL } from "qrcode";
import { AGENT_MANIFESTS, fallbackAgent } from "#/agents/manifests.ts";
import type { PermissionMode } from "#/agents/types.ts";
import { CONNECTOR_MANIFESTS, connectorWorkflow } from "#/connectors/manifests.ts";
import { oauthAppRegistration } from "#/connectors/oauth-app.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import { dispatcherIsAlive } from "#/dispatcher/instance.ts";
import type { AgentOnRunner, AgentView, ConnectionSettings, JsonValue, LoopEdit } from "#/lib/domain.ts";
import { VERSION } from "#/lib/version.ts";
import { listAgents, saveAgentSettings, setDefaultAgent, testAgent } from "#/server/agents.ts";
import {
  checkConnection,
  listConnections,
  removeConnection,
  saveAuthorizedConnection,
  startAuthAttempt,
  updateConnectionSettings,
} from "#/server/connections.ts";
import {
  createLoop,
  deleteLoop,
  getLoop,
  listLoops,
  loopReadiness,
  moveLoop,
  setLoopEnabled,
  updateLoop,
} from "#/server/loops.ts";
import { dataDir } from "#/server/paths.ts";
import { availableAgentIds, listRunners } from "#/server/runners.ts";
import { dispatcherSettings, setDispatcherPaused } from "#/server/settings.ts";
import { lookNow, loopPollState, runBacklog } from "#/server/signals.ts";
import {
  enqueuePrompt,
  enqueueTask,
  getTask,
  listRunnableAgents,
  listTasks,
  readTaskLog,
  requestCancel,
} from "#/server/tasks.ts";

/**
 * What the desktop app can ask the engine, by name. The same operations the
 * web pages reach through server functions, reached over plain JSON instead:
 * the native screens are Go, and know nothing of TanStack.
 *
 * Kept as one map so the Go side has one list to mirror.
 */
export type RpcHandler = (data: never) => Promise<unknown>;

/** The engine's own address, set once it listens. OAuth callbacks come here. */
let engineOrigin = "";
export function setEngineOrigin(origin: string): void {
  engineOrigin = origin;
}

/** Copied from the agents server functions, which the engine cannot import. */
async function withRunners(agents: AgentView[]): Promise<AgentView[]> {
  const runners = await listRunners();
  const available = await availableAgentIds();
  const stored = agents.find((agent) => agent.isDefault)?.agentId ?? null;
  const implicit = stored ? null : fallbackAgent(null, available);
  return agents.map((agent) => {
    const onRunners: AgentOnRunner[] = runners.flatMap((runner) => {
      const entry = runner.inventory.find((item) => item.agentId === agent.agentId);
      if (!entry?.installed) return [];
      return [
        {
          runnerId: runner.id,
          name: runner.name,
          status: runner.status,
          signedIn: entry.signedIn,
          version: entry.version,
        },
      ];
    });
    const isDefault = agent.agentId === stored || agent.agentId === implicit;
    return {
      ...agent,
      onRunners,
      isDefault,
      defaultIsImplicit: isDefault && agent.agentId === implicit,
    };
  });
}

/**
 * Every connector, with its workflows already merged onto their triggers, so
 * the Go side never has to repeat connectorWorkflow. Agents come along, with
 * their defaults, for the same reason.
 */
function manifests() {
  return {
    connectors: CONNECTOR_MANIFESTS.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      tagline: manifest.tagline,
      docsUrl: manifest.docsUrl ?? null,
      icon: manifest.icon,
      auth: manifest.auth,
      byHand: manifest.byHand,
      settings: manifest.settings,
      allowsMultipleAccounts: manifest.allowsMultipleAccounts,
      triggers: manifest.triggers,
      workflows: manifest.workflows
        .map((entry) => connectorWorkflow(manifest.id, entry.id))
        .filter((entry) => entry !== undefined),
      actions: manifest.actions,
    })),
    agents: AGENT_MANIFESTS,
  };
}

export const rpc = {
  // Loops
  getLoopsPage: async () => ({ loops: await listLoops(), readiness: await loopReadiness() }),
  getLoopReadiness: async () => await loopReadiness(),
  getLoopById: async (data: { id: string }) => await getLoop(data.id),
  saveLoop: async (data: LoopEdit) => {
    const { id, ...values } = data;
    return id ? await updateLoop(id, values) : await createLoop(values);
  },
  toggleLoop: async (data: { id: string; enabled: boolean }) =>
    await setLoopEnabled(data.id, data.enabled),
  removeLoop: async (data: { id: string }) => {
    await deleteLoop(data.id);
    return await listLoops();
  },
  reorderLoop: async (data: { id: string; direction: "up" | "down" }) =>
    await moveLoop(data.id, data.direction),
  getLoopPollState: async (data: { id: string }) => await loopPollState(data.id),
  runLoopBacklog: async (data: { id: string; key?: string }) => ({
    queued: await runBacklog(data.id, data.key),
  }),
  lookLoopNow: async (data: { id: string }) => await lookNow(data.id),

  // Tasks
  getInbox: async () => ({ tasks: await listTasks(), agents: await listRunnableAgents() }),
  getLoopTasks: async (data: { loopId: string }) => await listTasks({ loopId: data.loopId }),
  getTaskById: async (data: { id: string }) => await getTask(data.id),
  getTaskLog: async (data: { id: string }) => await readTaskLog(data.id),
  runPrompt: async (data: { prompt: string; agentId: string }) => await enqueuePrompt(data),
  runLoopNow: async (data: { loopId: string; url: string; dryRun: boolean }) =>
    await enqueueTask(data),
  stopTask: async (data: { id: string }) => await requestCancel(data.id),
  getDispatcherState: async () => ({
    alive: await dispatcherIsAlive(),
    hosted: false,
    ...(await dispatcherSettings()),
  }),
  pauseDispatcher: async (data: { paused: boolean }) => await setDispatcherPaused(data.paused),

  // Agents
  getAgentsPage: async () => ({ agents: await withRunners(await listAgents()) }),
  saveAgent: async (data: {
    agentId: string;
    permissionMode: PermissionMode;
    model: string | null;
    timeoutMs: number;
  }) => {
    await saveAgentSettings(data.agentId, {
      permissionMode: data.permissionMode,
      model: data.model,
      timeoutMs: data.timeoutMs,
    });
    return await withRunners(await listAgents());
  },
  chooseDefaultAgent: async (data: { agentId: string }) => {
    await setDefaultAgent(data.agentId);
    return await withRunners(await listAgents());
  },
  runAgentTest: async (data: { agentId: string }) => {
    const result = await testAgent(data.agentId);
    return {
      passed: result.passed,
      output: result.output.slice(0, 2000),
      detail: result.detail ?? null,
      durationMs: result.durationMs,
      command: result.command,
    };
  },

  // Connectors
  getConnectorOverview: async () => {
    const all = await listConnections();
    return Promise.all(
      CONNECTOR_MANIFESTS.map(async (manifest) => ({
        connectorId: manifest.id,
        readiness: await connectorRuntime(manifest.id).readiness(),
        connections: all.filter((connection) => connection.connectorId === manifest.id),
      })),
    );
  },
  /**
   * How to connect a browser-authorized connector from here: a device code
   * when the connector offers one, else a page to open in the browser, which
   * comes back to the engine's own loopback address.
   */
  beginConnect: async (data: { connectorId: string }) => {
    const runtime = connectorRuntime(data.connectorId);
    // A login this Mac already has comes first: one click, nothing to enter.
    if (runtime.auth.fromLocalLogin) {
      try {
        const connection = await saveAuthorizedConnection(data.connectorId, await runtime.auth.fromLocalLogin());
        return { kind: "connected" as const, accountLabel: connection.accountLabel };
      } catch (error) {
        if (!oauthAppRegistration(data.connectorId)) throw error;
      }
    }
    if (runtime.auth.startDeviceLogin && oauthAppRegistration(data.connectorId)) {
      return { kind: "device" as const, ...(await runtime.auth.startDeviceLogin()) };
    }
    if (!runtime.auth.startAuthorization) {
      throw new Error(`${data.connectorId} cannot start an authorization.`);
    }
    if (!engineOrigin) throw new Error("The engine has no address yet.");
    const state = randomBytes(16).toString("base64url");
    const redirectUri = `${engineOrigin}/oauth/${data.connectorId}/callback`;
    const { redirectUrl, verifier } = await runtime.auth.startAuthorization({ redirectUri, state });
    await startAuthAttempt({ connectorId: data.connectorId, state, verifier, redirectUri });
    return { kind: "browser" as const, url: redirectUrl };
  },
  continueDeviceLogin: async (data: { connectorId: string; attempt: JsonValue }) => {
    const runtime = connectorRuntime(data.connectorId);
    if (!runtime.auth.pollDeviceLogin) {
      throw new Error(`${data.connectorId} does not connect with a device code.`);
    }
    const outcome = await runtime.auth.pollDeviceLogin(data.attempt);
    if (outcome.state === "confirmed") {
      const connection = await saveAuthorizedConnection(data.connectorId, outcome.result);
      return { state: "connected" as const, accountLabel: connection.accountLabel };
    }
    if (outcome.state === "expired") return { state: "expired" as const, reason: outcome.reason };
    return { state: "pending" as const, attempt: outcome.attempt, hint: outcome.hint };
  },
  beginQrLogin: async (data: { connectorId: string }) => {
    const runtime = connectorRuntime(data.connectorId);
    if (!runtime.auth.startQrLogin) {
      throw new Error(`${data.connectorId} does not connect by scanning.`);
    }
    const challenge = await runtime.auth.startQrLogin();
    return {
      attempt: challenge.attempt,
      // A PNG, base64, for the Go side to decode and show. No data URL prefix.
      image: (await toDataURL(challenge.encode, { margin: 1, width: 240 })).replace(
        /^data:image\/png;base64,/,
        "",
      ),
      expiresInMs: challenge.expiresInMs,
    };
  },
  continueQrLogin: async (data: { connectorId: string; attempt: JsonValue }) => {
    const runtime = connectorRuntime(data.connectorId);
    if (!runtime.auth.pollQrLogin) {
      throw new Error(`${data.connectorId} does not connect by scanning.`);
    }
    const outcome = await runtime.auth.pollQrLogin(data.attempt);
    if (outcome.state === "confirmed") {
      const connection = await saveAuthorizedConnection(data.connectorId, outcome.result);
      return { state: "connected" as const, accountLabel: connection.accountLabel };
    }
    if (outcome.state === "expired") return { state: "expired" as const, reason: outcome.reason };
    return { state: "pending" as const, attempt: outcome.attempt, hint: outcome.hint };
  },
  connectWithToken: async (data: { connectorId: string; fields: Record<string, string> }) => {
    const runtime = connectorRuntime(data.connectorId);
    if (!runtime.auth.connectWithFields) {
      throw new Error(`${data.connectorId} does not connect with a token.`);
    }
    const result = await runtime.auth.connectWithFields(data.fields);
    const connection = await saveAuthorizedConnection(data.connectorId, result);
    return { accountLabel: connection.accountLabel };
  },
  disconnectConnection: async (data: { id: string }) => {
    await removeConnection(data.id);
    return { ok: true };
  },
  verifyConnection: async (data: { id: string }) => await checkConnection(data.id),
  saveConnectionSettings: async (data: { id: string; settings: ConnectionSettings }) =>
    await updateConnectionSettings(data.id, data.settings),

  // The desktop app itself
  getManifests: async () => manifests(),
  getStatus: async () => ({
    version: VERSION,
    pid: process.pid,
    dataDir: dataDir(),
    node: process.version,
    alive: await dispatcherIsAlive(),
    runners: await listRunners(),
    ...(await dispatcherSettings()),
  }),
} satisfies Record<string, RpcHandler>;

export type RpcName = keyof typeof rpc;

export function isRpcName(name: string): name is RpcName {
  return Object.hasOwn(rpc, name);
}
