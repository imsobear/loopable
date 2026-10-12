import { createFileRoute } from "@tanstack/react-router";
import { asRunner, completeAgentJob } from "@/server/runner-api.ts";

export const Route = createFileRoute("/api/runners/jobs/$taskId/complete")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        await asRunner(request, async (runnerId) => {
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
        }),
    },
  },
});
