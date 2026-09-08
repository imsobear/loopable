import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Bell } from "lucide-react";
import { toast } from "sonner";
import { SettingFieldInputs, initialFieldValues } from "@/components/setting-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_MANIFESTS } from "@/agents/manifests.ts";
import { connectorManifest, connectorWorkflow } from "@/connectors/manifests.ts";
import type { ConnectionSettings, RuleView } from "@/lib/domain.ts";
import { saveRule } from "@/server/functions/rules.ts";

const DEFAULT_AGENT = "__default";

/**
 * A rule is one of a connector's workflows with its knobs set, so this edits
 * the knobs and nothing else. What to watch for, what to ask and where to
 * write are the workflow's business, and are shown here only to be read.
 */
export function RuleForm({ rule }: { rule: RuleView }) {
  const navigate = useNavigate();
  const connector = connectorManifest(rule.connectorId);
  const workflow = connectorWorkflow(rule.connectorId, rule.workflowId);

  const [name, setName] = useState(rule.name);
  const [guidance, setGuidance] = useState(rule.guidance ?? "");
  const [agentId, setAgentId] = useState(rule.agentId ?? DEFAULT_AGENT);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [settings, setSettings] = useState<ConnectionSettings>(() =>
    initialFieldValues(workflow?.settings ?? [], rule.settings),
  );
  const [saving, setSaving] = useState(false);

  if (!workflow) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This workflow is no longer offered</AlertTitle>
        <AlertDescription>
          {connector?.name ?? rule.connectorId} used to have <code>{rule.workflowId}</code> and no
          longer does, so this rule cannot run or be edited. Deleting it is the only thing left to
          do with it.
        </AlertDescription>
      </Alert>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveRule({
        data: {
          id: rule.id,
          name,
          connectorId: rule.connectorId,
          workflowId: rule.workflowId,
          guidance: guidance.trim() || null,
          agentId: agentId === DEFAULT_AGENT ? null : agentId,
          settings,
          enabled,
        },
      });
      toast.success(`Saved ${saved.name}`);
      await navigate({ to: "/rules" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4 text-sm">
            <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p>
                When {workflow.trigger}, {connector?.name ?? rule.connectorId} hands it to an agent.
              </p>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <ArrowRight className="size-3.5 shrink-0" />
                It writes {workflow.writes}.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Only for your benefit, and worth changing if you run this workflow more than once.
            </p>
          </div>

          {workflow.settings.length > 0 ? (
            <div className="flex flex-col gap-5 rounded-lg border p-4">
              <p className="text-sm font-medium">Only when</p>
              <SettingFieldInputs
                fields={workflow.settings}
                values={settings}
                idPrefix="setting-"
                onChange={(key, value) => setSettings((prev) => ({ ...prev, [key]: value }))}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-guidance">Anything else the agent should know</Label>
            <p className="text-xs text-muted-foreground">
              Optional. Loopable already knows how to do this job; this is added to what it asks
              for, so keep it to what is true of your team rather than of the job.
            </p>
            <Textarea
              id="rule-guidance"
              rows={4}
              value={guidance}
              placeholder={workflow.guidancePlaceholder}
              onChange={(event) => setGuidance(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="rule-agent">Run it with</Label>
            <Select value={agentId} onValueChange={(value) => value && setAgentId(value)}>
              <SelectTrigger id="rule-agent" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === DEFAULT_AGENT
                      ? "The default agent"
                      : (AGENT_MANIFESTS.find((entry) => entry.id === value)?.name ?? value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_AGENT}>The default agent</SelectItem>
                {AGENT_MANIFESTS.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 border-t pt-5">
            <div>
              <Label htmlFor="rule-enabled">Enabled</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                A disabled rule is kept but never matches.
              </p>
            </div>
            <Switch id="rule-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save rule"}
        </Button>
        <Button variant="ghost" onClick={() => navigate({ to: "/rules" })} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
