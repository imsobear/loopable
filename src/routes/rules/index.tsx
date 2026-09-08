import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ConnectorIcon } from "@/components/connector-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { agentManifest } from "@/agents/manifests.ts";
import { connectorManifest, connectorWorkflow } from "@/connectors/manifests.ts";
import type { RuleReadiness, RuleView } from "@/lib/domain.ts";
import { getRulesPage, removeRule, reorderRule, toggleRule } from "@/server/functions/rules.ts";

export const Route = createFileRoute("/rules/")({
  loader: () => getRulesPage(),
  component: RulesPage,
});

function RulesPage() {
  const { rules, readiness } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each rule runs one workflow on its own and writes the result back. The first rule that
            matches something is the one that runs, so order matters.
          </p>
        </div>
        <Button render={<Link to="/rules/new" />}>
          <Plus />
          New rule
        </Button>
      </header>

      <Gaps readiness={readiness} hasRules={rules.length > 0} />

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No rules yet, so nothing is being watched for.
            </p>
            <Button variant="outline" render={<Link to="/rules/new" />}>
              See what Loopable can do
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {rules.map((rule, index) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          position={index + 1}
          first={index === 0}
          last={index === rules.length - 1}
        />
      ))}
    </div>
  );
}

/** Says what a rule still needs, without standing in the way of writing one. */
function Gaps({ readiness, hasRules }: { readiness: RuleReadiness; hasRules: boolean }) {
  const missing: string[] = [];
  if (readiness.connectedConnectorIds.length === 0) {
    missing.push("No account is connected yet, so no signal can arrive.");
  }
  if (readiness.installedAgentIds.length === 0) {
    missing.push("No coding agent was found on this machine, so nothing can be prepared.");
  } else if (!readiness.defaultAgentId) {
    missing.push("No default agent is chosen, so rules that do not name one cannot run.");
  }
  if (missing.length === 0 || !hasRules) {
    if (missing.length === 0) return null;
  }

  return (
    <Alert>
      <AlertTitle>Rules can be written, but nothing will run yet</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {missing.map((line) => (
          <span key={line}>{line}</span>
        ))}
        <span className="mt-1 flex gap-3 text-xs">
          <Link to="/connectors" className="underline">
            Connectors
          </Link>
          <Link to="/agents" className="underline">
            Agents
          </Link>
        </span>
      </AlertDescription>
    </Alert>
  );
}

function RuleCard({
  rule,
  position,
  first,
  last,
}: {
  rule: RuleView;
  position: number;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  const manifest = connectorManifest(rule.connectorId);
  const workflow = connectorWorkflow(rule.connectorId, rule.workflowId);
  // Named only when the rule pins one; otherwise the default is the story and
  // it is told on the agents page rather than here.
  const agent = rule.agentId ? agentManifest(rule.agentId) : undefined;
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
    <Card className={rule.enabled ? undefined : "opacity-70"}>
      <CardHeader className="flex flex-row items-start gap-3">
        <span className="mt-0.5 w-5 text-sm text-muted-foreground">{position}</span>
        {manifest ? (
          <ConnectorIcon icon={manifest.icon} accent={manifest.accent} />
        ) : null}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/rules/$ruleId" params={{ ruleId: rule.id }} className="font-medium hover:underline">
              {rule.name}
            </Link>
            {rule.enabled ? null : <Badge variant="secondary">Off</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {workflow
              ? `When ${workflow.trigger}, it writes ${workflow.writes}${agent ? `, using ${agent.name}` : ""}.`
              : `Built on ${rule.workflowId}, which is no longer offered.`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move up"
            disabled={busy || first}
            onClick={() => run(() => reorderRule({ data: { id: rule.id, direction: "up" } }))}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move down"
            disabled={busy || last}
            onClick={() => run(() => reorderRule({ data: { id: rule.id, direction: "down" } }))}
          >
            <ArrowDown />
          </Button>
          <Switch
            checked={rule.enabled}
            aria-label="Enabled"
            disabled={busy}
            onCheckedChange={(enabled) =>
              run(
                () => toggleRule({ data: { id: rule.id, enabled } }),
                enabled ? `${rule.name} is on` : `${rule.name} is off`,
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            disabled={busy}
            onClick={() => run(() => removeRule({ data: { id: rule.id } }), `Deleted ${rule.name}`)}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>
      {/* What the rule does is the workflow's, and is said above. The only
          thing here worth repeating is what this person added to it. */}
      {rule.guidance ? (
        <CardContent className="border-t pt-4">
          <p className="line-clamp-2 text-sm text-muted-foreground">{rule.guidance}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}
