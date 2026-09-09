import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { ConnectorIcon } from "@/components/connector-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allWorkflows } from "@/connectors/manifests.ts";
import { addLoopForWorkflow, getLoopsPage } from "@/server/functions/loops.ts";

export const Route = createFileRoute("/loops/new")({
  loader: async () => ({ loops: (await getLoopsPage()).loops }),
  component: NewLoopPage,
});

/**
 * There is no blank loop to write any more. Every loop is one of the
 * workflows a connector offers, already knowing its own job, so choosing is
 * the whole of creating one and the settings come after.
 */
function NewLoopPage() {
  const { loops } = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const add = async (connectorId: string, workflowId: string) => {
    setBusy(workflowId);
    try {
      const loop = await addLoopForWorkflow({ data: { connectorId, workflowId } });
      toast.success(`Added "${loop.name}"`);
      await navigate({ to: "/loops/$loopId", params: { loopId: loop.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/loops"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Loops
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New loop</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick what you want done. You can narrow it down to certain repositories, and add anything
          particular to your team, on the next screen.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {allWorkflows().map(({ connector, workflow }) => {
          const existing = loops.filter((loop) => loop.workflowId === workflow.id).length;
          return (
            <Card key={workflow.id}>
              <CardContent className="flex items-start gap-4 pt-6">
                <ConnectorIcon icon={connector.icon} accent={connector.accent} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{workflow.name}</p>
                    {existing > 0 ? (
                      <Badge variant="secondary">
                        {existing === 1 ? "Already have one" : `Already have ${existing}`}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">{workflow.summary}</p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      When {workflow.trigger}, it writes {workflow.writes}.
                    </span>
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => add(connector.id, workflow.id)}
                >
                  {busy === workflow.id ? "Adding..." : "Add"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
