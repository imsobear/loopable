import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Play } from "lucide-react";
import { EngineStatus } from "@/components/engine-status";
import { RuleForm } from "@/components/rule-form";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { connectorManifest } from "@/connectors/manifests.ts";
import { getRuleById } from "@/server/functions/rules.ts";
import { getRunnerState, getRuleTasks, runRuleNow } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/rules/$ruleId")({
  loader: async ({ params }) => {
    const rule = await getRuleById({ data: { id: params.ruleId } });
    if (!rule) throw notFound();
    return {
      rule,
      tasks: await getRuleTasks({ data: { ruleId: params.ruleId } }),
      engine: await getRunnerState(),
    };
  },
  component: RulePage,
});

function RulePage() {
  const { rule, tasks, engine } = Route.useLoaderData();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        to="/rules"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Rules
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{rule.name}</h1>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="flex flex-col gap-4 pt-2">
          <RunBox rule={rule} />
          <EngineStatus engine={engine} quiet />
          <TaskList
            tasks={tasks}
            showRule={false}
            empty="This rule has not run yet."
          />
        </TabsContent>

        <TabsContent value="settings" className="pt-2">
          <RuleForm rule={rule} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Until signals arrive on their own, a rule is tried by pointing it at
 * something. Dry run exists so a rule can be shaped without writing to a real
 * repository each time.
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
