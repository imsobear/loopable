import { createFileRoute } from "@tanstack/react-router";
import { pollRunnerLogin } from "@/server/runner-logins.ts";

/** `loopable login` asking whether its code has been approved yet. */
export const Route = createFileRoute("/api/runners/login/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { code?: string; pollSecret?: string };
        if (!body.code || !body.pollSecret) {
          return Response.json({ error: "Send the code and the poll secret." }, { status: 400 });
        }
        return Response.json(await pollRunnerLogin(body.code, body.pollSecret));
      },
    },
  },
});
