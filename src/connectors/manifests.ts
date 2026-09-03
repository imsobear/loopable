import { githubManifest } from "./github/manifest.ts";
import type { ConnectorId, ConnectorManifest } from "./types.ts";

/**
 * Client-safe registry. Imports are explicit rather than a glob so the bundler
 * can see exactly what ships and so a typo fails the build.
 */
export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [githubManifest];

export function connectorManifest(id: ConnectorId): ConnectorManifest | undefined {
  return CONNECTOR_MANIFESTS.find((manifest) => manifest.id === id);
}
