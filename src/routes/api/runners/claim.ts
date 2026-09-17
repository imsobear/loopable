import { createFileRoute } from "@tanstack/react-router";
import { bearer } from "@/server/access.ts";
import { runnerIdForToken } from "@/server/runners.ts";
import { claimAgentJob } from "@/server/runner-api.ts";

export const Route = createFileRoute("/api/runners/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runnerId = await runnerIdForToken(bearer(request));
        if (!runnerId) return Response.json({ error: "Unknown runner." }, { status: 401 });
        const job = await claimAgentJob(runnerId);
        return Response.json({ job });
      },
    },
  },
});
