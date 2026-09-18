import { createFileRoute } from "@tanstack/react-router";
import { bearer } from "@/server/access.ts";
import { runnerIdForToken } from "@/server/runners.ts";
import { touchRunner } from "@/server/runner-api.ts";
import type { RunnerInventoryEntry } from "@/lib/domain.ts";

export const Route = createFileRoute("/api/runners/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runnerId = await runnerIdForToken(bearer(request));
        if (!runnerId) return Response.json({ error: "Unknown runner." }, { status: 401 });
        const body = (await request.json()) as { inventory?: RunnerInventoryEntry[] };
        const view = await touchRunner(runnerId, body.inventory ?? []);
        return Response.json(view);
      },
    },
  },
});
