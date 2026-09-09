import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ConnectorIcon } from "@/components/connector-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { agentManifest } from "@/agents/manifests.ts";
import { connectorManifest, connectorWorkflow } from "@/connectors/manifests.ts";
import type { LoopReadiness, LoopView } from "@/lib/domain.ts";
import { getLoopsPage, removeLoop, reorderLoop, toggleLoop } from "@/server/functions/loops.ts";

export const Route = createFileRoute("/loops/")({
  loader: () => getLoopsPage(),
  component: LoopsPage,
});

function LoopsPage() {
  const { loops, readiness } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Loops</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each loop runs one workflow on its own and writes the result back. The first loop that
            matches something is the one that runs, so order matters.
          </p>
        </div>
        <Button render={<Link to="/loops/new" />}>
          <Plus />
          New loop
        </Button>
      </header>

      <Gaps readiness={readiness} hasLoops={loops.length > 0} />

      {loops.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No loops yet, so nothing is being watched for.
            </p>
            <Button variant="outline" render={<Link to="/loops/new" />}>
              See what Loopable can do
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loops.map((loop, index) => (
        <LoopCard
          key={loop.id}
          loop={loop}
          position={index + 1}
          first={index === 0}
          last={index === loops.length - 1}
        />
      ))}
    </div>
  );
}

/** Says what a loop still needs, without standing in the way of writing one. */
function Gaps({ readiness, hasLoops }: { readiness: LoopReadiness; hasLoops: boolean }) {
  const missing: string[] = [];
  if (readiness.connectedConnectorIds.length === 0) {
    missing.push("No account is connected yet, so no signal can arrive.");
  }
  if (readiness.installedAgentIds.length === 0) {
    missing.push("No coding agent was found on this machine, so nothing can be prepared.");
  } else if (!readiness.defaultAgentId) {
    missing.push("No default agent is chosen, so loops that do not name one cannot run.");
  }
  if (missing.length === 0 || !hasLoops) {
    if (missing.length === 0) return null;
  }

  return (
    <Alert>
      <AlertTitle>Loops can be written, but nothing will run yet</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {missing.map((line) => (
          <span key={line}>{line}</span>
        ))}
        <span className="mt-1 flex gap-3 text-xs">
          <Link to="/connectors" className="underline">
            Connectors
          </Link>
          <Link to="/agents" className="underline">
            Agents
          </Link>
        </span>
      </AlertDescription>
    </Alert>
  );
}

function LoopCard({
  loop,
  position,
  first,
  last,
}: {
  loop: LoopView;
  position: number;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  const manifest = connectorManifest(loop.connectorId);
  const workflow = connectorWorkflow(loop.connectorId, loop.workflowId);
  // Named only when the loop pins one; otherwise the default is the story and
  // it is told on the agents page rather than here.
  const agent = loop.agentId ? agentManifest(loop.agentId) : undefined;
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await work();
      await router.invalidate();
      if (message) toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={loop.enabled ? undefined : "opacity-70"}>
      <CardHeader className="flex flex-row items-start gap-3">
        <span className="mt-0.5 w-5 text-sm text-muted-foreground">{position}</span>
        {manifest ? (
          <ConnectorIcon icon={manifest.icon} accent={manifest.accent} />
        ) : null}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/loops/$loopId" params={{ loopId: loop.id }} className="font-medium hover:underline">
              {loop.name}
            </Link>
            {loop.enabled ? null : <Badge variant="secondary">Off</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {workflow
              ? `When ${workflow.trigger}, it writes ${workflow.writes}${agent ? `, using ${agent.name}` : ""}.`
              : `Built on ${loop.workflowId}, which is no longer offered.`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move up"
            disabled={busy || first}
            onClick={() => run(() => reorderLoop({ data: { id: loop.id, direction: "up" } }))}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move down"
            disabled={busy || last}
            onClick={() => run(() => reorderLoop({ data: { id: loop.id, direction: "down" } }))}
          >
            <ArrowDown />
          </Button>
          <Switch
            checked={loop.enabled}
            aria-label="Enabled"
            disabled={busy}
            onCheckedChange={(enabled) =>
              run(
                () => toggleLoop({ data: { id: loop.id, enabled } }),
                enabled ? `${loop.name} is on` : `${loop.name} is off`,
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            disabled={busy}
            onClick={() => run(() => removeLoop({ data: { id: loop.id } }), `Deleted ${loop.name}`)}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>
      {/* What the loop does is the workflow's, and is said above. The only
          thing here worth repeating is what this person added to it. */}
      {loop.guidance ? (
        <CardContent className="border-t pt-4">
          <p className="line-clamp-2 text-sm text-muted-foreground">{loop.guidance}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}
