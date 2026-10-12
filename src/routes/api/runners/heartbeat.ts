import { createFileRoute } from "@tanstack/react-router";
import { asRunner, touchRunner } from "@/server/runner-api.ts";
import type { RunnerInventoryEntry } from "@/lib/domain.ts";

export const Route = createFileRoute("/api/runners/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        await asRunner(request, async (runnerId) => {
          const body = (await request.json()) as {
            inventory?: RunnerInventoryEntry[];
            version?: string;
            protocol?: number;
          };
          const view = await touchRunner(runnerId, body.inventory ?? [], {
            version: body.version,
            protocol: body.protocol,
          });
          return Response.json(view);
        }),
    },
  },
});
