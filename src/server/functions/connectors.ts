import { createServerFn } from "@tanstack/react-start";
import { toDataURL } from "qrcode";
import { CONNECTOR_MANIFESTS } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type { Readiness } from "#/connectors/types.ts";
import type { ConnectionSettings, ConnectionView, JsonValue } from "#/lib/domain.ts";
import {
  checkConnection,
  listConnections,
  removeConnection,
  saveAuthorizedConnection,
  updateConnectionSettings,
} from "../connections.ts";

export type ConnectorOverview = {
  connectorId: string;
  readiness: Readiness;
  connections: ConnectionView[];
};

/** A code to show, and whatever the connector needs handed back when polling. */
export type QrLoginView = {
  attempt: JsonValue;
  /** The code as a data URL, ready to put in an img tag. */
  image: string;
  expiresInMs: number;
};

export type QrPollView =
  | { state: "pending"; attempt: JsonValue; hint?: string }
  | { state: "expired"; reason?: string }
  | { state: "connected"; accountLabel: string | null };

/**
 * Readiness and connections for every connector in the registry. Manifests are
 * imported directly by the client, so they are deliberately not sent again.
 */
export const getConnectorOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConnectorOverview[]> => {
    const all = await listConnections();
    return Promise.all(
      CONNECTOR_MANIFESTS.map(async (manifest) => ({
        connectorId: manifest.id,
        readiness: await connectorRuntime(manifest.id).readiness(),
        connections: all.filter((connection) => connection.connectorId === manifest.id),
      })),
    );
  },
);

/**
 * Starts a login that finishes on a phone. The code is rendered here rather
 * than in the browser so the page needs no QR library and never learns how the
 * provider's login works.
 */
export const beginQrLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { connectorId: string }) => data)
  .handler(async ({ data }): Promise<QrLoginView> => {
    const runtime = connectorRuntime(data.connectorId);
    if (!runtime.auth.startQrLogin) {
      throw new Error(`${data.connectorId} does not connect by scanning.`);
    }
    const challenge = await runtime.auth.startQrLogin();
    return {
      attempt: challenge.attempt,
      image: await toDataURL(challenge.encode, { margin: 1, width: 240 }),
      expiresInMs: challenge.expiresInMs,
    };
  });

/**
 * One look at a pending scan. The credential never reaches the browser: a
 * confirmed login is saved here and the page is told only that it worked.
 */
export const continueQrLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { connectorId: string; attempt: JsonValue }) => data)
  .handler(async ({ data }): Promise<QrPollView> => {
    const runtime = connectorRuntime(data.connectorId);
    if (!runtime.auth.pollQrLogin) {
      throw new Error(`${data.connectorId} does not connect by scanning.`);
    }
    const outcome = await runtime.auth.pollQrLogin(data.attempt);
    if (outcome.state === "confirmed") {
      const connection = await saveAuthorizedConnection(data.connectorId, outcome.result);
      return { state: "connected", accountLabel: connection.accountLabel };
    }
    if (outcome.state === "expired") return { state: "expired", reason: outcome.reason };
    return { state: "pending", attempt: outcome.attempt, hint: outcome.hint };
  });

export const disconnectConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await removeConnection(data.id);
    return { ok: true };
  });

export const verifyConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => await checkConnection(data.id));

export const saveConnectionSettings = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; settings: ConnectionSettings }) => data)
  .handler(async ({ data }) => await updateConnectionSettings(data.id, data.settings));
