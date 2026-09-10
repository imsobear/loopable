import { githubRuntime } from "./github/runtime.ts";
import { gmailRuntime } from "./gmail/runtime.ts";
import { scheduleRuntime } from "./schedule/runtime.ts";
import { wechatRuntime } from "./wechat/runtime.ts";
import type { Connector, ConnectorId } from "./types.ts";
import { CONNECTOR_MANIFESTS } from "./manifests.ts";

/** Server-only registry. Never import this from a component. */
const RUNTIMES: Record<ConnectorId, Connector["runtime"]> = {
  github: githubRuntime,
  gmail: gmailRuntime,
  wechat: wechatRuntime,
  schedule: scheduleRuntime,
};

export function connectorRuntime(id: ConnectorId): Connector["runtime"] {
  const runtime = RUNTIMES[id];
  if (!runtime) throw new Error(`Unknown connector: ${id}`);
  return runtime;
}

export function connector(id: ConnectorId): Connector {
  const manifest = CONNECTOR_MANIFESTS.find((entry) => entry.id === id);
  if (!manifest) throw new Error(`Unknown connector: ${id}`);
  return { manifest, runtime: connectorRuntime(id) };
}
