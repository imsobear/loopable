import { createFileRoute } from "@tanstack/react-router";
import { finishSignIn } from "@/server/sign-in-callback.ts";

/**
 * GitHub sends a signed-in browser back here. It lives under the GitHub
 * connection's callback so one registered callback URL covers both.
 */
export const Route = createFileRoute("/api/connectors/github/callback/signin")({
  server: {
    handlers: {
      GET: ({ request }) => finishSignIn(request, "github"),
    },
  },
});
