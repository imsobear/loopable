import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowUpCircle, Copy, LoaderCircle, RotateCcw, Server } from "lucide-react";
import { Empty, List, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { agentManifest } from "@/agents/manifests.ts";
import { cn } from "@/lib/utils";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import type { RunnerView } from "@/lib/domain.ts";
import {
  getRunnersPage,
  removeRunner,
  rotateRunnerJoinToken,
  toggleRunner,
  updateRunner,
} from "@/server/functions/runners.ts";

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

/** A block of commands with a copy button. */
function Commands({ lines }: { lines: string[] }) {
  const text = lines.join("\n");
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted p-1 pl-3">
      <pre className="min-w-0 flex-1 overflow-x-auto py-1.5 text-xs leading-relaxed">{text}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          toast.success("Copied");
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

function RunnersPage() {
  const { runners, joinToken, origin, hosted } = Route.useLoaderData();
  const router = useRouter();
  useLiveRefresh();
  // The CLI already points at the hosted service; any other address is named.
  const at = origin === "https://loop.goodone.si" ? "" : ` --url ${origin}`;
  const withToken = `loopable runner${at} --token ${joinToken}`;

  const rotate = async () => {
    if (!window.confirm("Rotate the join token? Runners already joined keep working.")) return;
    try {
      await rotateRunnerJoinToken();
      await router.invalidate();
      toast.success("Join token rotated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Runners"
        description="Machines that run agents for your loops."
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Join a runner</h2>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {hosted ? "On your machine:" : "On this machine or another on the network:"}
          </span>
          <Button variant="ghost" size="sm" onClick={rotate}>
            <RotateCcw />
            Rotate token
          </Button>
        </div>
        <Commands lines={["npm install -g loopable-cli", withToken]} />
        <p className="text-xs text-muted-foreground">
          Needs Node 22+ and an agent CLI signed in on that machine. It runs in the background, and the
          token is remembered, so after the first time it is just <code>loopable runner</code>. Stop it
          with <code>loopable stop</code>. Anyone with the token can add a runner to this workspace;
          rotate it if it gets out.
        </p>
      </div>

      {runners.length === 0 ? (
        <Empty>No runner has joined yet. Tasks wait until one is online.</Empty>
      ) : (
        <List>
          {runners.map((runner) => (
            <RunnerRow key={runner.id} runner={runner} />
          ))}
        </List>
      )}
    </div>
  );
}

function RunnerRow({ runner }: { runner: RunnerView }) {
  const router = useRouter();
  const act = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      await router.invalidate();
      if (done) toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const online = runner.status === "online";

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", !runner.enabled && "bg-muted/40")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Server className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-sm font-medium", !runner.enabled && "text-muted-foreground")}>
            {runner.name}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                !runner.enabled ? "bg-muted-foreground/50" : online ? "bg-emerald-500" : "bg-muted-foreground/50",
              )}
            />
            {!runner.enabled ? "Off: takes no jobs" : online ? "Online" : "Offline"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {runner.hostname} · {runner.version ? `v${runner.version}` : "version unknown"} · {agentsOn(runner)}
        </p>
        {runner.updateError ? (
          <p className="mt-1 text-xs text-destructive">
            Could not update: {runner.updateError} On that machine, run{" "}
            <code>npm install -g loopable-cli</code>, then <code>loopable stop</code> and{" "}
            <code>loopable runner</code>.
          </p>
        ) : runner.outdated && !runner.updatable && !runner.updating ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
            v{runner.latest} is out. On that machine, run <code>npm install -g loopable-cli</code>, then{" "}
            <code>loopable stop</code> and <code>loopable runner</code>.
          </p>
        ) : null}
      </div>

      {runner.updating ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Updating to v{runner.latest}
        </span>
      ) : runner.outdated && runner.updatable && online ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => act(() => updateRunner({ data: { id: runner.id } }), `Updating ${runner.name}`)}
        >
          <ArrowUpCircle />
          Update to v{runner.latest}
        </Button>
      ) : null}

      <Switch
        checked={runner.enabled}
        aria-label={runner.enabled ? `Turn ${runner.name} off` : `Turn ${runner.name} on`}
        onCheckedChange={(enabled) => act(() => toggleRunner({ data: { id: runner.id, enabled } }))}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const how = online
            ? `Stop ${runner.name} and forget it? It finishes the run it is on, then stops.`
            : `Forget ${runner.name}?`;
          if (!window.confirm(how)) return;
          void act(() => removeRunner({ data: { id: runner.id } }), online ? `Stopping ${runner.name}` : undefined);
        }}
      >
        Forget
      </Button>
    </div>
  );
}
