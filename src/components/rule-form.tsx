import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { SettingFieldInputs, initialFieldValues } from "@/components/setting-fields";
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
import { CONNECTOR_MANIFESTS, connectorManifest } from "@/connectors/manifests.ts";
import type { ConnectionSettings, RuleView } from "@/lib/domain.ts";
import { saveRule } from "@/server/functions/rules.ts";

const DEFAULT_AGENT = "__default";

function conditionFields(connectorId: string, eventId: string) {
  return connectorManifest(connectorId)?.events.find((event) => event.id === eventId)?.conditions ?? [];
}

export function RuleForm({ rule }: { rule?: RuleView }) {
  const navigate = useNavigate();
  const first = CONNECTOR_MANIFESTS[0]!;

  const [connectorId, setConnectorId] = useState(rule?.connectorId ?? first.id);
  const [eventId, setEventId] = useState(rule?.eventId ?? first.events[0]!.id);
  const [actionId, setActionId] = useState(rule?.actionId ?? first.actions[0]!.id);
  const [name, setName] = useState(rule?.name ?? "");
  const [instruction, setInstruction] = useState(rule?.instruction ?? "");
  const [agentId, setAgentId] = useState(rule?.agentId ?? DEFAULT_AGENT);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [conditions, setConditions] = useState<ConnectionSettings>(() =>
    initialFieldValues(
      conditionFields(rule?.connectorId ?? first.id, rule?.eventId ?? first.events[0]!.id),
      rule?.conditions ?? {},
    ),
  );
  const [saving, setSaving] = useState(false);

  const manifest = connectorManifest(connectorId)!;
  const fields = conditionFields(connectorId, eventId);

  /** Each event declares its own conditions, so switching drops the ones that no longer apply. */
  const chooseEvent = (next: string | null) => {
    if (!next) return;
    setEventId(next);
    setConditions((prev) => initialFieldValues(conditionFields(connectorId, next), prev));
  };

  const chooseConnector = (next: string | null) => {
    if (!next) return;
    const target = connectorManifest(next)!;
    setConnectorId(next);
    setEventId(target.events[0]!.id);
    setActionId(target.actions[0]!.id);
    setConditions(initialFieldValues(target.events[0]!.conditions ?? [], {}));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveRule({
        data: {
          id: rule?.id,
          name,
          connectorId,
          eventId,
          actionId,
          instruction,
          agentId: agentId === DEFAULT_AGENT ? null : agentId,
          conditions,
          enabled,
        },
      });
      toast.success(rule ? `Saved ${saved.name}` : `Created ${saved.name}`);
      await navigate({ to: "/rules" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const event = manifest.events.find((entry) => entry.id === eventId);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              placeholder="Review pull requests I am asked to review"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {CONNECTOR_MANIFESTS.length > 1 ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-connector">Service</Label>
                <Select value={connectorId} onValueChange={chooseConnector}>
                  <SelectTrigger id="rule-connector" className="w-full">
                    <SelectValue>
                      {(value: string) => connectorManifest(value)?.name ?? value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONNECTOR_MANIFESTS.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-event">When this happens</Label>
              <Select value={eventId} onValueChange={chooseEvent}>
                <SelectTrigger id="rule-event" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      manifest.events.find((entry) => entry.id === value)?.name ?? value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {manifest.events.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {event ? <p className="text-xs text-muted-foreground">{event.summary}</p> : null}
            </div>
          </div>

          {fields.length > 0 ? (
            <div className="flex flex-col gap-5 rounded-lg border p-4">
              <p className="text-sm font-medium">Only when</p>
              <SettingFieldInputs
                fields={fields}
                values={conditions}
                idPrefix="condition-"
                onChange={(key, value) => setConditions((prev) => ({ ...prev, [key]: value }))}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-instruction">Ask the agent to</Label>
            <p className="text-xs text-muted-foreground">
              Loopable adds the context from the event. Write only what you want done with it.
            </p>
            <Textarea
              id="rule-instruction"
              rows={5}
              value={instruction}
              placeholder="Review this pull request. Focus on correctness, security and missing tests."
              onChange={(event) => setInstruction(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-action">Then</Label>
              <Select value={actionId} onValueChange={(value) => value && setActionId(value)}>
                <SelectTrigger id="rule-action" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      manifest.actions.find((entry) => entry.id === value)?.name ?? value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {manifest.actions.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Written back automatically.</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-agent">Using</Label>
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
          {saving ? "Saving..." : rule ? "Save rule" : "Create rule"}
        </Button>
        <Button variant="ghost" onClick={() => navigate({ to: "/rules" })} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
