import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { TaskStateLabel } from "@/components/task-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { connectorManifest } from "@/connectors/manifests.ts";
import { getTaskById } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/inbox/$taskId")({
  loader: async ({ params }) => {
    const task = await getTaskById({ data: { id: params.taskId } });
    if (!task) throw notFound();
    return task;
  },
  component: TaskPage,
});

function TaskPage() {
  const task = Route.useLoaderData();
  const manifest = connectorManifest(task.connectorId);
  const action = manifest?.actions.find((entry) => entry.id === task.actionId);

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
          <h1 className="text-xl font-semibold tracking-tight">{task.sourceTitle}</h1>
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
        </div>
      </header>

      {task.error ? (
        <Alert variant="destructive">
          <AlertTitle>This run failed</AlertTitle>
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
          <Row label="Started">{new Date(task.createdAt).toLocaleString()}</Row>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
