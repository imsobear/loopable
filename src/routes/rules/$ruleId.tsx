import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CircleAlert, Eye, Play } from "lucide-react";
import { RuleForm } from "@/components/rule-form";
import { TaskList } from "@/components/task-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { connectorManifest } from "@/connectors/manifests.ts";
import type { RulePollState } from "@/lib/domain.ts";
import { getRuleById, getRulePollState, runRuleBacklog } from "@/server/functions/rules.ts";
import { getRuleTasks, runRuleNow } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/rules/$ruleId")({
  loader: async ({ params }) => {
    const rule = await getRuleById({ data: { id: params.ruleId } });
    if (!rule) throw notFound();
    return {
      rule,
      tasks: await getRuleTasks({ data: { ruleId: params.ruleId } }),
      poll: await getRulePollState({ data: { id: params.ruleId } }),
    };
  },
  component: RulePage,
});

function RulePage() {
  const { rule, tasks, poll } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/rules"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Rules
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{rule.name}</h1>

      <Watching rule={rule} poll={poll} />

      {/* Opening a rule is nearly always about changing it; its runs are in the
          inbox too. */}
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="pt-2">
          <RuleForm rule={rule} />
        </TabsContent>

        <TabsContent value="tasks" className="flex flex-col gap-4 pt-2">
          <RunBox rule={rule} />
          <TaskList tasks={tasks} showRule={false} empty="This rule has not run yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Whether the rule is really watching is the one thing a page cannot work out
 * for itself, and the thing a person most wants to know after turning one on.
 */
function Watching({
  rule,
  poll,
}: {
  rule: { id: string; enabled: boolean };
  poll: RulePollState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!rule.enabled) {
    return (
      <Alert>
        <AlertTitle>This rule is off</AlertTitle>
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
              : "Not looked yet. The engine checks every couple of minutes; the first look records what is already waiting without running it."}
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
                  Matched, but not run: either it was already there before the rule was made, or
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
                    const { queued } = await runRuleBacklog({ data: { id: rule.id } });
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
                  {item.sourceRepo} #{item.sourceNumber} · {item.sourceTitle}
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
 * A rule that runs by itself still has to be shaped, and waiting for a real
 * signal to arrive is a slow way to do it. Dry run means that shaping leaves
 * no marks on a real repository.
 */
function RunBox({ rule }: { rule: { id: string; connectorId: string } }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const manifest = connectorManifest(rule.connectorId);

  const run = async () => {
    setRunning(true);
    try {
      await runRuleNow({ data: { ruleId: rule.id, url: url.trim(), dryRun } });
      await router.invalidate();
      setUrl("");
      toast.success(dryRun ? "Queued as a dry run" : "Queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="run-url">Try this rule on a {manifest?.name ?? ""} link</Label>
          <div className="flex gap-2">
            <Input
              id="run-url"
              value={url}
              placeholder="https://github.com/acme/web/pull/123"
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button onClick={run} disabled={running || url.trim() === ""}>
              <Play />
              Run
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="run-dry">Dry run</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {dryRun
                ? "Prepare the result and show it to you, without writing anything."
                : "Write the result back, exactly as the rule would on its own."}
            </p>
          </div>
          <Switch id="run-dry" checked={dryRun} onCheckedChange={setDryRun} />
        </div>
      </CardContent>
    </Card>
  );
}
