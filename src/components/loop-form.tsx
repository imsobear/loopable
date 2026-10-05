import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Field, Section } from "@/components/page";
import { SettingFieldInputs, initialFieldValues } from "@/components/setting-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_MANIFESTS } from "@/agents/manifests.ts";
import {
  connectorAction,
  connectorManifest,
  connectorWorkflow,
  isInboxOnly,
  writerName,
  writers,
} from "@/connectors/manifests.ts";
import type { WorkflowDescriptor } from "@/connectors/types.ts";
import type { ConnectionSettings, LoopEdit } from "@/lib/domain.ts";
import { saveLoop } from "@/server/functions/loops.ts";

const DEFAULT_AGENT = "__default";

/** Zero is stored as null: "as often as the dispatcher does" is not a duration. */
const POLL_CHOICES = [
  { value: "0", label: "Every couple of minutes" },
  { value: String(60_000), label: "Every minute" },
  { value: String(10 * 60_000), label: "Every 10 minutes" },
  { value: String(30 * 60_000), label: "Every 30 minutes" },
  { value: String(60 * 60_000), label: "Every hour" },
  { value: String(4 * 60 * 60_000), label: "Every 4 hours" },
];

const RUNS_IN: Record<NonNullable<WorkflowDescriptor["runsIn"]>, string> = {
  checkout: "A fresh clone of the repository",
  folder: "The folder this loop names",
  temp: "A scratch folder with only what it was given",
};

const ANSWER: Record<WorkflowDescriptor["answer"], string> = {
  review: "A summary, plus comments on lines",
  code: "A change to the code",
  text: "One block of text",
};

/**
 * The parts of a workflow a loop cannot change: what it asks the service,
 * where the agent runs, and how the answer is read. Folded away, since they
 * are worth checking once and never editing.
 */
function WorkflowDetails({ workflow }: { workflow: WorkflowDescriptor }) {
  const rows: Array<[string, React.ReactNode]> = [];
  if (workflow.watches) {
    rows.push(["Looks for", <code className="font-mono text-xs">{workflow.watches}</code>]);
  }
  rows.push(["Runs in", RUNS_IN[workflow.runsIn ?? "temp"]]);
  rows.push(["Answer", ANSWER[workflow.answer]]);

  return (
    <details className="group text-sm">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        Fixed by the workflow
      </summary>
      <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * A loop is one of a connector's workflows with its own answers to the
 * questions it asks: what narrows it, which agent runs it and with what
 * words, and where the answer goes.
 *
 * Serves a loop that exists and one that does not. A loop with no id has been
 * chosen and not saved, so leaving this page is the end of it.
 */
export function LoopForm({ loop, trigger }: { loop: LoopEdit; trigger?: React.ReactNode }) {
  const navigate = useNavigate();
  const fresh = loop.id === null;
  const connector = connectorManifest(loop.connectorId);
  const workflow = connectorWorkflow(loop.connectorId, loop.workflowId);

  const [name, setName] = useState(loop.name);
  const [prompt, setPrompt] = useState(loop.prompt);
  const [guidance, setGuidance] = useState(loop.guidance ?? "");
  const [agentId, setAgentId] = useState(loop.agentId ?? DEFAULT_AGENT);
  const [settings, setSettings] = useState<ConnectionSettings>(() =>
    initialFieldValues(workflow?.settings ?? [], loop.settings),
  );
  const [pollEveryMs, setPollEveryMs] = useState(String(loop.pollEveryMs ?? 0));
  const [actionConnectorId, setActionConnectorId] = useState(loop.actionConnectorId);
  const [actionId, setActionId] = useState(loop.actionId);
  const [actionTarget, setActionTarget] = useState<ConnectionSettings>(() =>
    initialFieldValues(
      connectorAction(loop.actionConnectorId, loop.actionId)?.target ?? [],
      loop.actionTarget,
    ),
  );
  const [saving, setSaving] = useState(false);
  // A custom loop starts with no prompt, so there is nothing to say it came from.
  const [written] = useState(loop.prompt.trim() !== "");

  const action = connectorAction(actionConnectorId, actionId);
  const sourceName = connector?.name ?? loop.connectorId;

  const chooseDestination = (connectorId: string, id: string) => {
    setActionConnectorId(connectorId);
    setActionId(id);
    setActionTarget(initialFieldValues(connectorAction(connectorId, id)?.target ?? [], {}));
  };

  if (!workflow) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This workflow is no longer offered</AlertTitle>
        <AlertDescription>
          {sourceName} no longer has <code>{loop.workflowId}</code>, so this loop cannot run or be
          edited. You can still delete it.
        </AlertDescription>
      </Alert>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveLoop({
        data: {
          id: loop.id,
          name,
          connectorId: loop.connectorId,
          workflowId: loop.workflowId,
          prompt,
          guidance: guidance.trim() || null,
          agentId: agentId === DEFAULT_AGENT ? null : agentId,
          settings,
          actionConnectorId,
          actionId,
          actionTarget,
          pollEveryMs: Number(pollEveryMs) || null,
          // On/off lives in the page header, so this keeps whatever it is now.
          enabled: loop.enabled,
        },
      });
      toast.success(fresh ? `Added ${saved.name}` : `Saved ${saved.name}`);
      await navigate(
        fresh
          ? { to: "/loops/$loopId", params: { loopId: saved.id } }
          : { to: "/loops/$loopId", params: { loopId: saved.id }, search: { tab: "settings" } },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const crosses = action && actionConnectorId !== loop.connectorId;
  const flattens = action && workflow.answer === "review" && !action.accepts.includes("review");

  return (
    <div className="flex flex-col">
      <Section title="When" description={`When ${workflow.trigger}.`}>
        {trigger}
        <Field label="Name" htmlFor="loop-name">
          <Input id="loop-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <SettingFieldInputs
          fields={workflow.settings}
          values={settings}
          idPrefix="setting-"
          onChange={(key, value) => setSettings((prev) => ({ ...prev, [key]: value }))}
        />

        {/* A clock has its own times above; how often to look means nothing to it. */}
        {loop.connectorId === "schedule" ? null : (
          <Field label="Check" htmlFor="loop-every" className="sm:max-w-xs">
            <Select value={pollEveryMs} onValueChange={(value) => value && setPollEveryMs(value)}>
              <SelectTrigger id="loop-every" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    POLL_CHOICES.find((choice) => choice.value === value)?.label ??
                    `Every ${Math.round(Number(value) / 60_000)} minutes`
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {POLL_CHOICES.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <WorkflowDetails workflow={workflow} />
      </Section>

      <Section title="Agent">
        <Field label="Run with" htmlFor="loop-agent" className="sm:max-w-xs">
          <Select value={agentId} onValueChange={(value) => value && setAgentId(value)}>
            <SelectTrigger id="loop-agent" className="w-full">
              <SelectValue>
                {(value: string) =>
                  value === DEFAULT_AGENT
                    ? "Default agent"
                    : (AGENT_MANIFESTS.find((entry) => entry.id === value)?.name ?? value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_AGENT}>Default agent</SelectItem>
              {AGENT_MANIFESTS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Prompt"
          htmlFor="loop-prompt"
          hint={written ? `Starts as “${workflow.name}”. Changes stay on this loop.` : undefined}
        >
          <Textarea
            id="loop-prompt"
            rows={10}
            className="font-mono text-xs"
            placeholder="What should the agent do?"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </Field>

        <Field label="Team notes" htmlFor="loop-guidance" hint="Optional. Added after the prompt.">
          <Textarea
            id="loop-guidance"
            rows={3}
            value={guidance}
            placeholder={workflow.guidancePlaceholder}
            onChange={(event) => setGuidance(event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Answer">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send to" htmlFor="loop-writer">
            <Select
              value={actionConnectorId}
              onValueChange={(value) =>
                value && chooseDestination(value, connectorManifest(value)!.actions[0]!.id)
              }
            >
              <SelectTrigger id="loop-writer" className="w-full">
                <SelectValue>{(value: string) => writerName(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {writers().map((writer) => (
                  <SelectItem key={writer.id} value={writer.id}>
                    {writerName(writer.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {isInboxOnly(actionConnectorId, actionId) ? null : (
            <Field label="As" htmlFor="loop-action">
              <Select
                value={actionId}
                onValueChange={(value) => value && chooseDestination(actionConnectorId, value)}
              >
                <SelectTrigger id="loop-action" className="w-full">
                  <SelectValue>
                    {(value: string) => connectorAction(actionConnectorId, value)?.name ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(connectorManifest(actionConnectorId)?.actions ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>

        {crosses && !isInboxOnly(actionConnectorId, actionId) ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            {sourceName} and {writerName(actionConnectorId)} both need a connection.
          </p>
        ) : flattens ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            Line comments arrive as text, with file and line written in.
          </p>
        ) : null}

        {action && action.target.length > 0 ? (
          <SettingFieldInputs
            fields={action.target}
            values={actionTarget}
            idPrefix="target-"
            onChange={(key, value) => setActionTarget((prev) => ({ ...prev, [key]: value }))}
          />
        ) : null}
      </Section>

      <div className="flex items-center gap-2 border-t pt-6 md:pl-52">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : fresh ? "Add loop" : "Save changes"}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            navigate(
              fresh
                ? { to: "/loops/new" }
                : { to: "/loops/$loopId", params: { loopId: loop.id! } },
            )
          }
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
