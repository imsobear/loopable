import { createFileRoute } from "@tanstack/react-router";
import { asRunner, claimAgentJob } from "@/server/runner-api.ts";

export const Route = createFileRoute("/api/runners/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return await asRunner(request, async (runnerId) =>
          Response.json({ job: await claimAgentJob(runnerId) }),
        );
      },
    },
  },
});
