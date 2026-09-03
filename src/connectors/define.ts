import type { ConnectorManifest, ConnectorRuntime } from "./types.ts";

export function defineManifest(manifest: ConnectorManifest): ConnectorManifest {
  return manifest;
}

export function defineRuntime(runtime: ConnectorRuntime): ConnectorRuntime {
  return runtime;
}
