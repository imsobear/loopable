import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Copy, RotateCcw, Server } from "lucide-react";
import { Empty, List, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { agentManifest } from "@/agents/manifests.ts";
import { cn } from "@/lib/utils";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import type { RunnerView } from "@/lib/domain.ts";
import { getRunnersPage, removeRunner, rotateRunnerJoinToken } from "@/server/functions/runners.ts";

export const Route = createFileRoute("/runners/")({
  loader: () => getRunnersPage(),
  component: RunnersPage,
});

/** Which agents this runner has, in a few words. */
function agentsOn(runner: RunnerView): string {
  if (runner.inventory.length === 0) return "No agents found";
  return runner.inventory
    .map((entry) => {
      const name = agentManifest(entry.agentId)?.name ?? entry.agentId;
      return entry.signedIn ? name : entry.installed ? `${name} (not signed in)` : `${name} (missing)`;
    })
    .join(", ");
}

function RunnersPage() {
  const { runners, joinToken, origin } = Route.useLoaderData();
  const router = useRouter();
  useLiveRefresh();
  const command = `loopable runner --url ${origin} --token ${joinToken}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Runners" description="Machines that run agents for your loops." />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Join a runner</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!window.confirm("Rotate the join token? Runners already joined keep working.")) return;
              try {
                await rotateRunnerJoinToken();
                await router.invalidate();
                toast.success("Join token rotated");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            <RotateCcw />
            Rotate token
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-muted p-1 pl-3">
          <code className="min-w-0 flex-1 overflow-x-auto py-1.5 text-xs whitespace-nowrap">{command}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy"
            onClick={async () => {
              await navigator.clipboard.writeText(command);
              toast.success("Copied");
            }}
          >
            <Copy />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Run it on any machine with <code>loopable-cli</code> installed and an agent signed in.
        </p>
      </div>

      {runners.length === 0 ? (
        <Empty>No runner has joined yet. Tasks wait until one is online.</Empty>
      ) : (
        <List>
          {runners.map((runner) => (
            <div key={runner.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Server className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{runner.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        runner.status === "online" ? "bg-emerald-500" : "bg-muted-foreground/50",
                      )}
                    />
                    {runner.status === "online" ? "Online" : "Offline"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {runner.hostname} · {agentsOn(runner)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await removeRunner({ data: { id: runner.id } });
                    await router.invalidate();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                Forget
              </Button>
            </div>
          ))}
        </List>
      )}
    </div>
  );
}
