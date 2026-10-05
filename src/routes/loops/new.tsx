import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { PencilLine } from "lucide-react";
import { ConnectorIcon } from "@/components/connector-icon";
import { LoopForm } from "@/components/loop-form";
import { Field, PageHeader } from "@/components/page";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { allWorkflows, connectorManifest, connectorWorkflow } from "@/connectors/manifests.ts";
import type { ConnectorManifest, WorkflowDescriptor } from "@/connectors/types.ts";
import type { LoopView } from "@/lib/domain.ts";
import { draftForWorkflow } from "@/lib/loop-draft.ts";
import { getLoopsPage } from "@/server/functions/loops.ts";

type Search = { connector?: string; workflow?: string; custom?: boolean };

export const Route = createFileRoute("/loops/new")({
  // Which workflow is being shaped lives in the URL rather than in state, so
  // the back button steps out of the form and a half-filled one is never
  // something on the server has to remember.
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {};
    if (typeof search.connector === "string") result.connector = search.connector;
    if (typeof search.workflow === "string") result.workflow = search.workflow;
    if (search.custom === true || search.custom === "true" || search.custom === 1) result.custom = true;
    return result;
  },
  loader: async () => ({ loops: (await getLoopsPage()).loops }),
  component: NewLoopPage,
});

/** The trigger a custom loop starts on before anything is picked. */
const CUSTOM_DEFAULT = { connector: "slack", workflow: "slack.ask" };

function NewLoopPage() {
  const { connector, workflow, custom } = Route.useSearch();
  const chosen =
    connector && workflow && connectorWorkflow(connector, workflow)
      ? { connector, workflow }
      : null;

  if (custom) {
    const start = chosen ?? CUSTOM_DEFAULT;
    return <CustomLoop connectorId={start.connector} workflowId={start.workflow} />;
  }
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
 * A loop with your own prompt. Underneath it is still one of the workflows,
 * since a workflow is what knows how to watch for something and read the
 * answer, but it starts with an empty prompt and a trigger you pick.
 */
function CustomLoop({ connectorId, workflowId }: { connectorId: string; workflowId: string }) {
  const navigate = useNavigate();
  const draft = {
    ...draftForWorkflow(connectorId, workflowId),
    name: "Custom loop",
    prompt: "",
  };

  const picker = (
    <Field label="Starts when" htmlFor="custom-trigger" className="sm:max-w-sm">
      <Select
        value={`${connectorId}::${workflowId}`}
        onValueChange={(value) => {
          if (!value) return;
          const [connector, workflow] = value.split("::") as [string, string];
          void navigate({
            to: "/loops/new",
            search: { custom: true, connector, workflow },
            replace: true,
          });
        }}
      >
        <SelectTrigger id="custom-trigger" className="w-full">
          <SelectValue>
            {() => {
              const workflow = connectorWorkflow(connectorId, workflowId);
              return workflow?.when ?? workflow?.name ?? workflowId;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allWorkflows().map(({ connector, workflow }) => (
            <SelectItem key={workflow.id} value={`${connector.id}::${workflow.id}`}>
              {workflow.when ?? workflow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ to: "/loops/new", label: "New loop" }}
        icon={<CustomIcon />}
        title="Custom loop"
        description="Pick what starts it, then say what the agent should do."
      />
      {/* Keyed on the trigger: each one has its own fields and its own place
          to answer, so changing it starts the form over. */}
      <LoopForm key={workflowId} loop={draft} trigger={picker} />
    </div>
  );
}

function CustomIcon() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
      <PencilLine className="size-5" />
    </span>
  );
}

/** How many loops already use a workflow, said as a sentence rather than a count. */
function inUse(loops: LoopView[], workflowId: string): string | null {
  const count = loops.filter((loop) => loop.workflowId === workflowId).length;
  if (count === 0) return null;
  return count === 1 ? "You have 1 loop like this" : `You have ${count} loops like this`;
}

function ChoiceCard({
  icon,
  title,
  summary,
  note,
  ...link
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  note?: string | null;
  search: Search;
}) {
  return (
    <Link
      to="/loops/new"
      search={link.search}
      className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
        {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </Link>
  );
}

function workflowCard(
  connector: ConnectorManifest,
  workflow: WorkflowDescriptor,
  loops: LoopView[],
) {
  return (
    <ChoiceCard
      key={workflow.id}
      icon={<ConnectorIcon icon={connector.icon} accent={connector.accent} className="size-8" />}
      title={workflow.name}
      summary={workflow.summary}
      note={inUse(loops, workflow.id)}
      search={{ connector: connector.id, workflow: workflow.id }}
    />
  );
}

/**
 * Every loop is one of the workflows a connector offers, or a custom one
 * built on a workflow's trigger. Custom and Schedule come first: they are the
 * two not tied to something arriving from a service.
 */
function ChooseWorkflow() {
  const { loops } = Route.useLoaderData();
  const all = allWorkflows();
  const scheduled = all.filter(({ connector }) => connector.id === "schedule");
  const rest = all.filter(({ connector }) => connector.id !== "schedule");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ to: "/loops", label: "Loops" }} title="New loop" />

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          icon={
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <PencilLine className="size-4" />
            </span>
          }
          title="Custom loop"
          summary="Pick a trigger and write your own prompt."
          search={{ custom: true }}
        />
        {scheduled.map(({ connector, workflow }) => workflowCard(connector, workflow, loops))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">From a connector</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {rest.map(({ connector, workflow }) => workflowCard(connector, workflow, loops))}
        </div>
      </div>
    </div>
  );
}
