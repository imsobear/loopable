import { createFileRoute } from "@tanstack/react-router";
import { bearer } from "@/server/access.ts";
import { runnerIdForToken } from "@/server/runners.ts";
import { completeAgentJob } from "@/server/runner-api.ts";

export const Route = createFileRoute("/api/runners/jobs/$taskId/complete")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const runnerId = await runnerIdForToken(bearer(request));
        if (!runnerId) return Response.json({ error: "Unknown runner." }, { status: 401 });
        const body = (await request.json()) as {
          ok?: boolean;
          output?: string;
          detail?: string;
          aborted?: boolean;
          command?: string;
        };
        try {
          await completeAgentJob(params.taskId, runnerId, {
            ok: body.ok !== false,
            output: body.output ?? "",
            detail: body.detail,
            aborted: body.aborted,
            command: body.command ?? "",
          });
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
