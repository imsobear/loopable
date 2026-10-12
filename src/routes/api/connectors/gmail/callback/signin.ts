import { createFileRoute } from "@tanstack/react-router";
import { finishSignIn } from "@/server/sign-in-callback.ts";

/**
 * Google sends a signed-in browser back here. Sign-in shares the Gmail
 * connection's Google client, so it sits beside that connection's callback.
 */
export const Route = createFileRoute("/api/connectors/gmail/callback/signin")({
  server: {
    handlers: {
      GET: ({ request }) => finishSignIn(request, "google"),
    },
  },
});
