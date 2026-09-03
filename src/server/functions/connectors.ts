import { createServerFn } from "@tanstack/react-start";
import { CONNECTOR_MANIFESTS } from "@/connectors/manifests.ts";
import { connectorRuntime } from "@/connectors/runtimes.ts";
import type { Readiness } from "@/connectors/types.ts";
import type { ConnectionSettings, ConnectionView } from "@/lib/domain.ts";
import {
  checkConnection,
  listConnections,
  removeConnection,
  updateConnectionSettings,
} from "../connections.ts";

export type ConnectorOverview = {
  connectorId: string;
  readiness: Readiness;
  connections: ConnectionView[];
};

/**
 * Readiness and connections for every connector in the registry. Manifests are
 * imported directly by the client, so they are deliberately not sent again.
 */
export const getConnectorOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConnectorOverview[]> => {
    const all = listConnections();
    return Promise.all(
      CONNECTOR_MANIFESTS.map(async (manifest) => ({
        connectorId: manifest.id,
        readiness: await connectorRuntime(manifest.id).readiness(),
        connections: all.filter((connection) => connection.connectorId === manifest.id),
      })),
    );
  },
);

export const disconnectConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await removeConnection(data.id);
    return { ok: true };
  });

export const verifyConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => checkConnection(data.id));

export const saveConnectionSettings = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; settings: ConnectionSettings }) => data)
  .handler(({ data }) => updateConnectionSettings(data.id, data.settings));
