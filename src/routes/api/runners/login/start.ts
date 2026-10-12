import { createFileRoute } from "@tanstack/react-router";
import { appOrigin } from "@/lib/callback.ts";
import { startRunnerLogin } from "@/server/runner-logins.ts";

/** `loopable login` begins here: a code to show, and where to approve it. */
export const Route = createFileRoute("/api/runners/login/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const login = await startRunnerLogin();
        const url = `${appOrigin(request.url)}/runners/connect?code=${encodeURIComponent(login.code)}`;
        return Response.json({ ...login, url });
      },
    },
  },
});
