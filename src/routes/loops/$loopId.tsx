import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CircleAlert, Eye, Play } from "lucide-react";
import { LoopForm } from "@/components/loop-form";
import { TaskList } from "@/components/task-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { connectorManifest } from "@/connectors/manifests.ts";
import type { LoopPollState } from "@/lib/domain.ts";
import { issuesFor } from "@/lib/gaps.ts";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import { getLoopById, getLoopPollState, getLoopReadiness, runLoopBacklog } from "@/server/functions/loops.ts";
import { getLoopTasks, runLoopNow } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/loops/$loopId")({
  loader: async ({ params }) => {
    const loop = await getLoopById({ data: { id: params.loopId } });
    if (!loop) throw notFound();
    return {
      loop,
      tasks: await getLoopTasks({ data: { loopId: params.loopId } }),
      poll: await getLoopPollState({ data: { id: params.loopId } }),
      readiness: await getLoopReadiness(),
    };
  },
  component: LoopPage,
});

function LoopPage() {
  const { loop, tasks, poll, readiness } = Route.useLoaderData();
  useLiveRefresh();
  const issues = issuesFor(readiness, loop);

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/loops"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Loops
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{loop.name}</h1>

      {issues.length > 0 ? (
        <Alert>
          <CircleAlert />
          <AlertTitle>This loop cannot run yet</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            {issues.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <Watching loop={loop} poll={poll} />

      {/* Opening a loop is nearly always about changing it; its runs are in the
          inbox too. */}
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="pt-2">
          <LoopForm loop={loop} />
        </TabsContent>

        <TabsContent value="tasks" className="flex flex-col gap-4 pt-2">
          <RunBox loop={loop} />
          <TaskList tasks={tasks} showLoop={false} empty="This loop has not run yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Whether the loop is really watching is the one thing a page cannot work out
 * for itself, and the thing a person most wants to know after turning one on.
 */
function Watching({
  loop,
  poll,
}: {
  loop: { id: string; enabled: boolean };
  poll: LoopPollState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!loop.enabled) {
    return (
      <Alert>
        <AlertTitle>This loop is off</AlertTitle>
        <AlertDescription>Nothing is being watched for until you turn it back on.</AlertDescription>
      </Alert>
    );
  }

  if (poll.pollError) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>The last look did not work</AlertTitle>
        <AlertDescription>{poll.pollError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex items-start gap-3 text-sm">
          <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            {poll.polledAt
              ? `Watching. Last looked ${when(poll.polledAt)}.`
              : "Not looked yet. The dispatcher checks every couple of minutes; the first look records what is already waiting without running it."}
          </p>
        </div>

        {poll.backlog.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {poll.backlog.length === 1
                    ? "One thing is waiting"
                    : `${poll.backlog.length} things are waiting`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Matched, but not run: either it was already there before the loop was made, or
                  it was held back for the reason shown. Run them if you want them dealt with too.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const { queued } = await runLoopBacklog({ data: { id: loop.id } });
                    await router.invalidate();
                    toast.success(queued === 1 ? "Queued 1 run" : `Queued ${queued} runs`);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Queueing..." : "Run these too"}
              </Button>
            </div>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {poll.backlog.slice(0, 8).map((item) => (
                <li key={item.key} className="truncate">
                  {item.sourceRef} · {item.sourceTitle}
                  {item.hold ? <span className="text-foreground"> · {item.hold}</span> : null}
                </li>
              ))}
              {poll.backlog.length > 8 ? <li>and {poll.backlog.length - 8} more</li> : null}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A loop that runs by itself still has to be shaped, and waiting for a real
 * signal to arrive is a slow way to do it. Dry run means that shaping leaves
 * no marks on a real repository.
 */
function RunBox({ loop }: { loop: { id: string; connectorId: string } }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const manifest = connectorManifest(loop.connectorId);
  const byHand = manifest?.byHand ?? { kind: "none" as const };

  const run = async () => {
    setRunning(true);
    try {
      await runLoopNow({ data: { loopId: loop.id, url: url.trim(), dryRun } });
      await router.invalidate();
      setUrl("");
      toast.success(dryRun ? "Queued as a dry run" : "Queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  // Nothing here can start a run, so the card would be a box that only makes
  // errors. Saying why is more use than offering one.
  if (byHand.kind === "none") {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          This loop can only run on something arriving, so there is nothing to start by hand. What
          it does with what arrives is worth trying on the first one, with dry run left on.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-col gap-2">
          {byHand.kind === "now" ? (
            <>
              <Label>Run it now, without waiting for the time</Label>
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Runs exactly as it would when the clock came round, and does not count as that
                  run: the next scheduled one still happens.
                </p>
                <Button onClick={run} disabled={running}>
                  <Play />
                  Run
                </Button>
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="run-url">Try this loop on a {manifest?.name ?? ""} link</Label>
              <div className="flex gap-2">
                <Input
                  id="run-url"
                  value={url}
                  placeholder={byHand.placeholder}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <Button onClick={run} disabled={running || url.trim() === ""}>
                  <Play />
                  Run
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="run-dry">Dry run</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {dryRun
                ? "Prepare the result and show it to you, without writing anything."
                : "Write the result back, exactly as the loop would on its own."}
            </p>
          </div>
          <Switch id="run-dry" checked={dryRun} onCheckedChange={setDryRun} />
        </div>
      </CardContent>
    </Card>
  );
}
