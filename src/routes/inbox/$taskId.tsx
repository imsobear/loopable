import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { ArrowLeft, CircleStop, ExternalLink, Loader } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TaskStateLabel, taskTitle } from "@/components/task-list";
import { useLiveTasks } from "@/components/use-live-tasks.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { connectorManifest } from "@/connectors/manifests.ts";
import { isTaskActive, type TaskView } from "@/lib/domain.ts";
import { getTaskById, getTaskLog, stopTask } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/inbox/$taskId")({
  loader: async ({ params }) => {
    const task = await getTaskById({ data: { id: params.taskId } });
    if (!task) throw notFound();
    return { task, log: await getTaskLog({ data: { id: params.taskId } }) };
  },
  component: TaskPage,
});

function TaskPage() {
  const { task, log } = Route.useLoaderData();
  const manifest = connectorManifest(task.connectorId);
  const action = manifest?.actions.find((entry) => entry.id === task.actionId);
  useLiveTasks([task]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        to="/inbox"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Inbox
      </Link>

      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{taskTitle(task)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {task.sourceRepo} #{task.sourceNumber} ·{" "}
            <Link to="/rules/$ruleId" params={{ ruleId: task.ruleId }} className="underline">
              {task.ruleName}
            </Link>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <TaskStateLabel state={task.state} />
          {task.dryRun ? <Badge variant="outline">Dry run</Badge> : null}
          {isTaskActive(task.state) ? <StopButton task={task} /> : null}
        </div>
      </header>

      {task.error ? (
        <Alert variant={task.state === "failed" ? "destructive" : undefined}>
          <AlertTitle>
            {task.state === "failed"
              ? "This run failed"
              : task.state === "cancelled"
                ? "Stopped before it finished"
                : "Waiting to try again"}
          </AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{task.error}</AlertDescription>
        </Alert>
      ) : null}

      {task.state === "skipped" ? (
        <Alert>
          <AlertTitle>Nothing was written</AlertTitle>
          <AlertDescription>
            The agent judged there was nothing worth posting, so Loopable stayed quiet.
          </AlertDescription>
        </Alert>
      ) : null}

      {task.output ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <CardTitle className="flex-1 text-base">
              {task.state === "done" ? "What was written" : "What the agent wrote"}
            </CardTitle>
            {task.resultUrl ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={task.resultUrl} target="_blank" rel="noreferrer" />}
              >
                See it on GitHub
                <ExternalLink />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm">{task.output}</pre>
          </CardContent>
        </Card>
      ) : null}

      {log ? <AgentLog log={log} live={isTaskActive(task.state)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How this ran</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Row label="Source">
            <a
              href={task.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              {task.sourceKind === "pull_request" ? "Pull request" : "Issue"} #{task.sourceNumber}
              <ExternalLink className="size-3" />
            </a>
          </Row>
          <Row label="Action">{action?.name ?? task.actionId}</Row>
          <Row label="Agent">{task.agentId ?? "unknown"}</Row>
          <Row label="Queued">{new Date(task.createdAt).toLocaleString()}</Row>
          {task.attempts > 1 ? <Row label="Attempt">{task.attempts}</Row> : null}
          {task.durationMs ? (
            <Row label="Took">{(task.durationMs / 1000).toFixed(1)}s</Row>
          ) : null}
          {task.agentCommand ? (
            <div>
              <p className="text-xs text-muted-foreground">Command</p>
              <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2.5 text-xs">
                {task.agentCommand}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Everything the agent printed, as it prints it. Four minutes of a spinner
 * tells you nothing; this is what tells you the run is alive, and afterwards
 * it is the only place that explains a failure.
 */
function AgentLog({ log, live }: { log: string; live: boolean }) {
  const box = useRef<HTMLPreElement>(null);

  // Stay at the bottom while it is still being written, the way a tail does.
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [live, log]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <CardTitle className="flex-1 text-base">Agent log</CardTitle>
        {live ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader className="size-3.5 animate-spin" />
            still running
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <pre
          ref={box}
          className="max-h-80 overflow-auto rounded-md bg-muted p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words"
        >
          {log}
        </pre>
      </CardContent>
    </Card>
  );
}

/**
 * The run is in the other process, so this only leaves a note. The daemon
 * sees it when it next renews its claim, which is why the button says it has
 * been asked for rather than pretending it is already done.
 */
function StopButton({ task }: { task: TaskView }) {
  const router = useRouter();
  const [asked, setAsked] = useState(task.cancelRequested);

  const stop = async () => {
    setAsked(true);
    try {
      await stopTask({ data: { id: task.id } });
      await router.invalidate();
    } catch (error) {
      setAsked(false);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={stop} disabled={asked}>
      <CircleStop />
      {asked ? "Stopping" : "Stop"}
    </Button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
