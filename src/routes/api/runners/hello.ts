import { createFileRoute } from "@tanstack/react-router";
import { bearer } from "@/server/access.ts";
import { joinRunner } from "@/server/runners.ts";

export const Route = createFileRoute("/api/runners/hello")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            hostname?: string;
            inventory?: Parameters<typeof joinRunner>[0]["inventory"];
          };
          const result = await joinRunner({
            joinToken: bearer(request),
            hostname: body.hostname ?? "unknown",
            inventory: body.inventory ?? [],
          });
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = message.includes("join token") ? 401 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
