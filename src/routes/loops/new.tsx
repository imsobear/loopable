import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ConnectorIcon } from "@/components/connector-icon";
import { LoopForm } from "@/components/loop-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allWorkflows, connectorManifest, connectorWorkflow } from "@/connectors/manifests.ts";
import { draftForWorkflow } from "@/lib/loop-draft.ts";
import { getLoopsPage } from "@/server/functions/loops.ts";

export const Route = createFileRoute("/loops/new")({
  // Which workflow is being shaped lives in the URL rather than in state, so
  // the back button steps out of the form and a half-filled one is never
  // something on the server has to remember.
  validateSearch: (search: Record<string, unknown>) => {
    const result: { connector?: string; workflow?: string } = {};
    if (typeof search.connector === "string") result.connector = search.connector;
    if (typeof search.workflow === "string") result.workflow = search.workflow;
    return result;
  },
  loader: async () => ({ loops: (await getLoopsPage()).loops }),
  component: NewLoopPage,
});

function NewLoopPage() {
  const { connector, workflow } = Route.useSearch();
  const chosen =
    connector && workflow && connectorWorkflow(connector, workflow)
      ? { connector, workflow }
      : null;

  return chosen ? (
    <ShapeLoop connectorId={chosen.connector} workflowId={chosen.workflow} />
  ) : (
    <ChooseWorkflow />
  );
}

/**
 * The second step, and the one that makes a loop.
 *
 * Nothing has been written down yet: the draft is worked out here from the
 * workflow the URL names, and the loop begins when the form is saved. Picking
 * a workflow used to create it, which meant a look around this page left a
 * live loop behind, enabled and with none of its questions answered.
 */
function ShapeLoop({ connectorId, workflowId }: { connectorId: string; workflowId: string }) {
  const workflow = connectorWorkflow(connectorId, workflowId)!;
  const connector = connectorManifest(connectorId);

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/loops/new"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        New loop
      </Link>
      <header className="flex items-start gap-4">
        {connector ? <ConnectorIcon icon={connector.icon} accent={connector.accent} /> : null}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is watched for until you add this. {workflow.summary}
          </p>
        </div>
      </header>
      <LoopForm loop={draftForWorkflow(connectorId, workflowId)} />
    </div>
  );
}

/**
 * There is no blank loop to write any more. Every loop is one of the
 * workflows a connector offers, already knowing its own job, so choosing is
 * the first half of making one and the settings are the second.
 */
function ChooseWorkflow() {
  const { loops } = Route.useLoaderData();
  const navigate = useNavigate();

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
                  onClick={() =>
                    void navigate({
                      to: "/loops/new",
                      search: { connector: connector.id, workflow: workflow.id },
                    })
                  }
                >
                  Set up
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
