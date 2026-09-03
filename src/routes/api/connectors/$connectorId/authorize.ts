import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { connectorRuntime } from "@/connectors/runtimes.ts";
import { connectorManifest } from "@/connectors/manifests.ts";
import { startAuthAttempt } from "@/server/connections.ts";
import { appOrigin, callbackUrl } from "@/lib/callback.ts";

export const Route = createFileRoute("/api/connectors/$connectorId/authorize")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { connectorId } = params;
        const origin = appOrigin(request.url);
        const failed = (message: string) =>
          Response.redirect(`${origin}/connectors?error=${encodeURIComponent(message)}`, 302);

        const manifest = connectorManifest(connectorId);
        if (!manifest) return failed(`Unknown connector: ${connectorId}`);
        if (manifest.auth.kind !== "oauth_redirect") {
          return failed(`${manifest.name} does not use browser authorization.`);
        }

        try {
          const runtime = connectorRuntime(connectorId);
          const readiness = await runtime.readiness();
          if (!readiness.ready) return failed(readiness.reason);
          if (!runtime.auth.startAuthorization) {
            return failed(`${manifest.name} cannot start an authorization.`);
          }

          const state = randomBytes(16).toString("base64url");
          const redirectUri = callbackUrl(request.url, connectorId);
          const { redirectUrl, verifier } = await runtime.auth.startAuthorization({
            redirectUri,
            state,
          });
          startAuthAttempt({ connectorId, state, verifier, redirectUri });
          return Response.redirect(redirectUrl, 302);
        } catch (error) {
          return failed(error instanceof Error ? error.message : String(error));
        }
      },
    },
  },
});
