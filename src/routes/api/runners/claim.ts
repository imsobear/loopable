import { createFileRoute } from "@tanstack/react-router";
import { asRunner, claimAgentJob } from "@/server/runner-api.ts";
import { instructionFor } from "@/server/runners.ts";

export const Route = createFileRoute("/api/runners/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return await asRunner(request, async (runnerId) => {
          // Asked about every second, so a stop or an update is heard at once.
          const instruction = await instructionFor(runnerId);
          if (instruction) return Response.json({ job: null, instruction });
          return Response.json({ job: await claimAgentJob(runnerId) });
        });
      },
    },
  },
});
