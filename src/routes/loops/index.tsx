import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CircleAlert, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { ConnectorIcon } from "@/components/connector-icon";
import { Empty, List, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { agentManifest } from "@/agents/manifests.ts";
import { connectorAction, connectorManifest, connectorWorkflow } from "@/connectors/manifests.ts";
import type { LoopReadiness, LoopView } from "@/lib/domain.ts";
import { gapsFor, issuesFor } from "@/lib/gaps.ts";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import { getLoopsPage, removeLoop, reorderLoop, toggleLoop } from "@/server/functions/loops.ts";

export const Route = createFileRoute("/loops/")({
  loader: () => getLoopsPage(),
  component: LoopsPage,
});

function LoopsPage() {
  const { loops, readiness } = Route.useLoaderData();
  useLiveRefresh();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Loops"
        description="When two loops match the same thing, the higher one runs."
        actions={
          <Button nativeButton={false} render={<Link to="/loops/new" />}>
            <Plus />
            New loop
          </Button>
        }
      />

      <Gaps readiness={readiness} loops={loops} />

      {loops.length === 0 ? (
        <Empty
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/loops/new" />}>
              New loop
            </Button>
          }
        >
          No loops yet.
        </Empty>
      ) : (
        <List>
          {loops.map((loop, index) => (
            <LoopRow
              key={loop.id}
              loop={loop}
              readiness={readiness}
              position={index + 1}
              first={index === 0}
              last={index === loops.length - 1}
            />
          ))}
        </List>
      )}
    </div>
  );
}

/** What still stands between these loops and running. */
function Gaps({ readiness, loops }: { readiness: LoopReadiness; loops: LoopView[] }) {
  const missing = gapsFor(readiness, loops);
  if (missing.length === 0) return null;

  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>Nothing will run yet</AlertTitle>
      <AlertDescription className="flex flex-col gap-0.5">
        {missing.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </AlertDescription>
    </Alert>
  );
}

/** Where this loop answers and with what, in a few words. */
function summaryOf(loop: LoopView): string {
  if (!connectorWorkflow(loop.connectorId, loop.workflowId)) return "Workflow no longer offered";
  const action = connectorAction(loop.actionConnectorId, loop.actionId);
  const writer = connectorManifest(loop.actionConnectorId);
  const agent = loop.agentId ? agentManifest(loop.agentId) : undefined;
  return [
    action ? `${writer?.name ?? loop.actionConnectorId} · ${action.name}` : "No destination",
    agent?.name ?? "Default agent",
  ].join(" · ");
}

function LoopRow({
  loop,
  readiness,
  position,
  first,
  last,
}: {
  loop: LoopView;
  readiness: LoopReadiness;
  position: number;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  const manifest = connectorManifest(loop.connectorId);
  const issues = issuesFor(readiness, loop);
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
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
        {position}
      </span>
      {manifest ? (
        <ConnectorIcon
          icon={manifest.icon}
          accent={manifest.accent}
          className={loop.enabled ? "size-8" : "size-8 opacity-50"}
        />
      ) : null}
      <Link
        to="/loops/$loopId"
        params={{ loopId: loop.id }}
        className="group min-w-0 flex-1"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium group-hover:underline">{loop.name}</span>
          {loop.enabled ? null : <Badge variant="secondary">Off</Badge>}
        </div>
        {issues.length > 0 ? (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-amber-700 dark:text-amber-500">
            <CircleAlert className="size-3 shrink-0" />
            {issues[0]}
          </p>
        ) : (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{summaryOf(loop)}</p>
        )}
      </Link>
      <Switch
        checked={loop.enabled}
        aria-label={loop.enabled ? "Turn off" : "Turn on"}
        disabled={busy}
        onCheckedChange={(enabled) =>
          run(
            () => toggleLoop({ data: { id: loop.id, enabled } }),
            enabled ? `${loop.name} is on` : `${loop.name} is off`,
          )
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="More" disabled={busy} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={first}
            onClick={() => run(() => reorderLoop({ data: { id: loop.id, direction: "up" } }))}
          >
            <ArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={last}
            onClick={() => run(() => reorderLoop({ data: { id: loop.id, direction: "down" } }))}
          >
            <ArrowDown />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (!window.confirm(`Delete ${loop.name}? Its runs are deleted with it.`)) return;
              void run(() => removeLoop({ data: { id: loop.id } }), `Deleted ${loop.name}`);
            }}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
