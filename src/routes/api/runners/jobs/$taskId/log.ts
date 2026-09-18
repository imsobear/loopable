import { createFileRoute } from "@tanstack/react-router";
import { bearer } from "@/server/access.ts";
import { runnerIdForToken } from "@/server/runners.ts";
import { appendAgentLog } from "@/server/runner-api.ts";

export const Route = createFileRoute("/api/runners/jobs/$taskId/log")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const runnerId = await runnerIdForToken(bearer(request));
        if (!runnerId) return Response.json({ error: "Unknown runner." }, { status: 401 });
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
      },
    },
  },
});
