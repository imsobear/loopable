import { createFileRoute } from "@tanstack/react-router";
import { asRunner, touchRunner } from "@/server/runner-api.ts";
import { instructionFor } from "@/server/runners.ts";
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
            updatable?: boolean;
            updateError?: string;
          };
          const view = await touchRunner(runnerId, body.inventory ?? [], {
            version: body.version,
            protocol: body.protocol,
            updatable: body.updatable,
            updateError: body.updateError,
          });
          // Also said here, for a runner busy with a long job and not claiming.
          return Response.json({ ...view, instruction: await instructionFor(runnerId) });
        }),
    },
  },
});
