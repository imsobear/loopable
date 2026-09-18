import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Server } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import type { RunnerView } from "@/lib/domain.ts";
import { getRunnersPage, removeRunner, rotateRunnerJoinToken } from "@/server/functions/runners.ts";

export const Route = createFileRoute("/runners/")({
  loader: () => getRunnersPage(),
  component: RunnersPage,
});

function inventoryLines(runner: RunnerView) {
  if (runner.inventory.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No coding agents found yet.</p>;
  }
  return (
    <ul className="mt-2 text-sm text-muted-foreground">
      {runner.inventory.map((entry) => (
        <li key={entry.agentId}>
          {entry.agentId}
          {entry.signedIn ? " · signed in" : entry.installed ? " · not signed in" : " · missing"}
        </li>
      ))}
    </ul>
  );
}

function RunnersPage() {
  const { runners, joinToken, origin } = Route.useLoaderData();
  const router = useRouter();
  useLiveRefresh();

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Runners</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A runner is a process that runs agents. Join one on every host that should do work.
        </p>
      </header>

      <Card>
        <CardHeader className="text-base font-medium">Join a runner</CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Install the CLI once (<code className="text-xs">npm install -g loopable-cli</code>),
            sign in a coding agent on that host, then start a runner. Use this LAN IP so
            other machines can reach the App.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {`loopable runner --url ${origin} --token ${joinToken}`}
          </pre>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await rotateRunnerJoinToken();
                  await router.invalidate();
                  toast.success("Join token rotated. Existing runners keep working.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              Rotate join token
            </Button>
          </div>
        </CardContent>
      </Card>

      {runners.length === 0 ? (
        <Alert>
          <AlertDescription>
            No runner has joined yet. Loops will wait until one is online.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          {runners.map((runner) => (
            <Card key={runner.id}>
              <CardContent className="flex items-start gap-4 pt-6">
                <Server className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{runner.name}</p>
                    <Badge variant={runner.status === "online" ? "default" : "outline"}>
                      {runner.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{runner.hostname}</p>
                  {inventoryLines(runner)}
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
