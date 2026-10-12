import { createFileRoute } from "@tanstack/react-router";
import { asRunner, appendAgentLog } from "@/server/runner-api.ts";

export const Route = createFileRoute("/api/runners/jobs/$taskId/log")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        await asRunner(request, async (runnerId) => {
          const body = (await request.json()) as { chunk?: string };
          try {
            await appendAgentLog(params.taskId, runnerId, body.chunk ?? "");
            return Response.json({ ok: true });
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 409 },
            );
          }
        }),
    },
  },
});
