import { Link, createFileRoute } from "@tanstack/react-router";
import { ConnectorIcon } from "@/components/connector-icon";
import { LoopForm } from "@/components/loop-form";
import { PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
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
 * The second step, and the one that makes a loop. Nothing is written down
 * until the form is saved.
 */
function ShapeLoop({ connectorId, workflowId }: { connectorId: string; workflowId: string }) {
  const workflow = connectorWorkflow(connectorId, workflowId)!;
  const connector = connectorManifest(connectorId);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ to: "/loops/new", label: "New loop" }}
        icon={connector ? <ConnectorIcon icon={connector.icon} accent={connector.accent} /> : null}
        title={workflow.name}
        description={workflow.summary}
      />
      <LoopForm loop={draftForWorkflow(connectorId, workflowId)} />
    </div>
  );
}

/**
 * Every loop is one of the workflows a connector offers, so choosing one is
 * the first half of making a loop and its settings are the second.
 */
function ChooseWorkflow() {
  const { loops } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ to: "/loops", label: "Loops" }} title="New loop" />

      <div className="grid gap-3 sm:grid-cols-2">
        {allWorkflows().map(({ connector, workflow }) => {
          const existing = loops.filter((loop) => loop.workflowId === workflow.id).length;
          return (
            <Link
              key={workflow.id}
              to="/loops/new"
              search={{ connector: connector.id, workflow: workflow.id }}
              className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50"
            >
              <ConnectorIcon icon={connector.icon} accent={connector.accent} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{workflow.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{workflow.summary}</p>
                {existing > 0 ? (
                  <Badge variant="secondary" className="mt-2">
                    {existing === 1 ? "1 loop" : `${existing} loops`}
                  </Badge>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
