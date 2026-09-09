import { createFileRoute } from "@tanstack/react-router";
import { connectorRuntime } from "@/connectors/runtimes.ts";
import { saveAuthorizedConnection, takeAuthAttempt } from "@/server/connections.ts";
import { appOrigin } from "@/lib/callback.ts";

export const Route = createFileRoute("/api/connectors/$connectorId/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const origin = appOrigin(request.url);
        const url = new URL(request.url);
        const done = (query: string) => Response.redirect(`${origin}/connectors?${query}`, 302);
        const failed = (message: string) => done(`error=${encodeURIComponent(message)}`);

        const denied = url.searchParams.get("error");
        if (denied) {
          return failed(url.searchParams.get("error_description") ?? denied);
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return failed("No authorization code came back.");

        try {
          const attempt = takeAuthAttempt(state);
          if (attempt.connectorId !== params.connectorId) {
            return failed("This authorization belongs to a different connector.");
          }
          const runtime = connectorRuntime(attempt.connectorId);
          if (!runtime.auth.completeAuthorization) {
            return failed("This connector cannot complete a browser authorization.");
          }
          const result = await runtime.auth.completeAuthorization({
            code,
            redirectUri: attempt.redirectUri,
            verifier: attempt.verifier,
          });
          const connection = await saveAuthorizedConnection(attempt.connectorId, result);
          return done(`connected=${encodeURIComponent(connection.accountLabel)}`);
        } catch (error) {
          return failed(error instanceof Error ? error.message : String(error));
        }
      },
    },
  },
});
