import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { ChevronRight, CircleStop, ExternalLink, FileCode, Loader } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page";
import { KIND_LABEL, TaskStateLabel, taskTitle } from "@/components/task-list";
import { useLiveTasks } from "@/components/use-live-tasks.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { agentManifest } from "@/agents/manifests.ts";
import { connectorAction, connectorManifest } from "@/connectors/manifests.ts";
import { isTaskActive, type TaskView } from "@/lib/domain.ts";
import type { Finding } from "@/lib/review.ts";
import { ago } from "@/lib/time.ts";
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
  // The connector that writes, which is not always the one that was read.
  const writer = connectorManifest(task.actionConnectorId);
  const action = connectorAction(task.actionConnectorId, task.actionId);
  const agent = task.agentId ? agentManifest(task.agentId) : undefined;
  const live = isTaskActive(task.state);
  useLiveTasks([task]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: "/inbox", label: "Inbox" }}
        title={taskTitle(task)}
        actions={
          <>
            {task.dryRun ? <Badge variant="outline">Dry run</Badge> : null}
            <TaskStateLabel state={task.state} />
            {live ? <StopButton task={task} /> : null}
          </>
        }
      >
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {task.sourceKind === "prompt" ? (
            <span>{KIND_LABEL.prompt}</span>
          ) : task.sourceUrl ? (
            <a href={task.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
              {task.sourceRef}
            </a>
          ) : (
            <span>{task.sourceRef}</span>
          )}
          {task.loopId ? (
            <>
              <span>·</span>
              <Link to="/loops/$loopId" params={{ loopId: task.loopId }} className="hover:text-foreground hover:underline">
                {task.loopName}
              </Link>
            </>
          ) : null}
          {agent ? <span>· {agent.name}</span> : null}
          <span>· {ago(task.createdAt)}</span>
        </p>
      </PageHeader>

      {task.error ? (
        <Alert variant={task.state === "failed" ? "destructive" : undefined}>
          <AlertTitle>
            {task.state === "failed"
              ? "Failed"
              : task.state === "cancelled"
                ? "Stopped"
                : "Will try again"}
          </AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{task.error}</AlertDescription>
        </Alert>
      ) : null}

      {task.output ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <CardTitle className="flex-1">
              {task.state === "done" ? "Written" : task.state === "skipped" ? "Nothing to write" : "Result"}
            </CardTitle>
            {task.resultUrl ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={task.resultUrl} target="_blank" rel="noreferrer" />}
              >
                Open in {writer?.name ?? task.actionConnectorId}
                <ExternalLink />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{task.output}</pre>
            {task.comments.length > 0 ? <Comments comments={task.comments} /> : null}
          </CardContent>
        </Card>
      ) : task.state === "skipped" ? (
        <p className="text-sm text-muted-foreground">The agent had nothing to say, so nothing was written.</p>
      ) : null}

      {log ? <AgentLog log={log} live={live} open={live || task.state === "failed"} /> : null}

      <Fold title="Details">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
          {task.sourceKind === "prompt" ? null : (
            <Row label="Writes">
              {action?.name ?? task.actionId}
              {task.actionConnectorId === task.connectorId
                ? null
                : ` on ${writer?.name ?? task.actionConnectorId}`}
            </Row>
          )}
          <Row label="Queued">{new Date(task.createdAt).toLocaleString()}</Row>
          {task.durationMs ? <Row label="Took">{(task.durationMs / 1000).toFixed(1)}s</Row> : null}
          {task.attempts > 1 ? <Row label="Attempts">{task.attempts}</Row> : null}
          {task.prompt ? (
            <Row label="Prompt">
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2.5 text-xs whitespace-pre-wrap">
                {task.prompt}
              </pre>
            </Row>
          ) : null}
          {task.agentCommand ? (
            <Row label="Command">
              <pre className="overflow-x-auto rounded-md bg-muted p-2.5 text-xs">{task.agentCommand}</pre>
            </Row>
          ) : null}
        </dl>
      </Fold>
    </div>
  );
}

/** A titled block that opens and closes, for what is only sometimes worth reading. */
function Fold({
  title,
  open,
  aside,
  children,
}: {
  title: string;
  open?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group rounded-xl bg-card ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="flex-1">{title}</span>
        {aside}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/**
 * The findings that go on the lines rather than in the body. Shown separately
 * because that is what they are: on GitHub they will be spread across the
 * diff, and this is the only place they can be read as a list.
 */
function Comments({ comments }: { comments: Finding[] }) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        {comments.length === 1 ? "1 line comment" : `${comments.length} line comments`}
      </p>
      {comments.map((comment, index) => (
        <div key={`${comment.path}:${comment.line}:${index}`} className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <FileCode className="size-3.5 shrink-0" />
            <span className="truncate">
              {comment.path}:{comment.startLine ? `${comment.startLine}-${comment.line}` : comment.line}
            </span>
          </p>
          <pre className="whitespace-pre-wrap break-words border-l-2 pl-3 font-sans text-sm leading-relaxed">
            {comment.body}
          </pre>
        </div>
      ))}
    </div>
  );
}

/**
 * Everything the agent printed, as it prints it. Four minutes of a spinner
 * tells you nothing; this is what tells you the run is alive, and afterwards
 * it is the only place that explains a failure.
 */
function AgentLog({ log, live, open }: { log: string; live: boolean; open: boolean }) {
  const box = useRef<HTMLPreElement>(null);

  // Stay at the bottom while it is still being written, the way a tail does.
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [live, log]);

  return (
    <Fold
      title="Agent log"
      open={open}
      aside={
        live ? (
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <Loader className="size-3.5 animate-spin" />
            Running
          </span>
        ) : null
      }
    >
      <pre
        ref={box}
        className="max-h-96 overflow-auto rounded-md bg-muted p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words"
      >
        {log}
      </pre>
    </Fold>
  );
}

/**
 * The run is in the other process, so this only leaves a note. The dispatcher
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
    <div className="contents">
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
