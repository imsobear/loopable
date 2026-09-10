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
import {
  CONNECTOR_MANIFESTS,
  connectorAction,
  connectorManifest,
  connectorWorkflow,
} from "@/connectors/manifests.ts";
import type { ConnectionSettings, LoopEdit } from "@/lib/domain.ts";
import { saveLoop } from "@/server/functions/loops.ts";

const DEFAULT_AGENT = "__default";

/** Zero is stored as null: "as often as the engine does" is not a duration. */
const POLL_CHOICES = [
  { value: "0", label: "Every time the engine looks" },
  { value: String(10 * 60_000), label: "Every 10 minutes" },
  { value: String(30 * 60_000), label: "Every 30 minutes" },
  { value: String(60 * 60_000), label: "Every hour" },
  { value: String(4 * 60 * 60_000), label: "Every 4 hours" },
];

/** Connectors that can write at all, for the question of where the answer goes. */
const WRITERS = CONNECTOR_MANIFESTS.filter((entry) => entry.actions.length > 0);

/**
 * Shown rather than hidden, and locked rather than editable.
 *
 * These are the parts of a workflow that only mean anything alongside the code
 * that reads them: the query a connector sends, whether the agent gets a
 * checkout, how its answer is parsed. Copying them onto a loop would freeze
 * whatever was true the day it was made, and leaving them off the page would
 * mean nobody could see what their loop actually does.
 */
function Locked({
  label,
  value,
  help,
  mono,
}: {
  label: string;
  value: string;
  help: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      <Input
        readOnly
        disabled
        value={value}
        className={mono ? "font-mono text-xs disabled:opacity-100" : "disabled:opacity-100"}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * A loop is one of a connector's workflows with its own answers to the
 * questions it asks. Which of those a loop owns is the whole shape of this
 * page: what it looks for and how the answer is read belong to the workflow
 * and are locked, while what narrows it, where it writes and which agent runs
 * it belong to the loop.
 *
 * Serves a loop that exists and one that does not. A loop with no id has been
 * chosen and not saved, so leaving this page is the end of it: nothing was
 * written down, and nothing is watching for anything.
 */
export function LoopForm({ loop }: { loop: LoopEdit }) {
  const navigate = useNavigate();
  const fresh = loop.id === null;
  const connector = connectorManifest(loop.connectorId);
  const workflow = connectorWorkflow(loop.connectorId, loop.workflowId);

  const [name, setName] = useState(loop.name);
  const [prompt, setPrompt] = useState(loop.prompt);
  const [guidance, setGuidance] = useState(loop.guidance ?? "");
  const [agentId, setAgentId] = useState(loop.agentId ?? DEFAULT_AGENT);
  const [enabled, setEnabled] = useState(loop.enabled);
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

  const action = connectorAction(actionConnectorId, actionId);
  const writerName = connectorManifest(actionConnectorId)?.name ?? actionConnectorId;

  /** Changing where the answer goes changes what has to be said about it. */
  const chooseAction = (connectorId: string, id: string) => {
    setActionConnectorId(connectorId);
    setActionId(id);
    setActionTarget(initialFieldValues(connectorAction(connectorId, id)?.target ?? [], {}));
  };

  if (!workflow) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This workflow is no longer offered</AlertTitle>
        <AlertDescription>
          {connector?.name ?? loop.connectorId} used to have <code>{loop.workflowId}</code> and no
          longer does, so this loop cannot run or be edited. Deleting it is the only thing left to
          do with it.
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
          enabled,
        },
      });
      toast.success(fresh ? `Added "${saved.name}"` : `Saved ${saved.name}`);
      await navigate({ to: "/loops" });
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
                When {workflow.trigger}, {connector?.name ?? loop.connectorId} hands it to an agent.
              </p>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <ArrowRight className="size-3.5 shrink-0" />
                {action
                  ? `Then, on ${writerName}: ${action.name.toLowerCase()}.`
                  : "Where the answer goes is no longer offered; choose again below."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loop-name">Name</Label>
            <Input
              id="loop-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Only for your benefit, and worth changing if you run this workflow more than once.
            </p>
          </div>

          <Locked
            label="What it looks for"
            mono
            value={workflow.watches ?? "Nothing is asked for; it arrives as it happens"}
            help={
              workflow.watches
                ? `Word for word what Loopable asks ${connector?.name ?? loop.connectorId} every couple of minutes${
                    workflow.settings.length > 0
                      ? ", before anything below narrows it further."
                      : "."
                  }`
                : `${connector?.name ?? loop.connectorId} sends this over as it happens, and Loopable picks it up within a couple of minutes.`
            }
          />

          <Locked
            label="Where the agent runs"
            value={
              workflow.runsIn === "checkout"
                ? "In a scratch worktree cut from the folder this loop names"
                : workflow.runsIn === "folder"
                  ? "In the folder this loop names"
                  : "In a scratch directory holding only what it was given"
            }
            help={
              workflow.runsIn === "checkout"
                ? "This job writes code, so it gets a checkout of its own. Your folder is only the source it is cut from: nothing is edited there, and anything you have uncommitted stays yours."
                : workflow.runsIn === "folder"
                  ? "This job reads real code to do its work, so it runs in a real checkout. It does not write there: anything it changed would be sitting in your working copy."
                  : "Judging a change needs the change and nothing else, so the agent gets no checkout to wander into."
            }
          />

          <Locked
            label="How its answer is read"
            value={
              workflow.answer === "review"
                ? "A summary, plus points attached to lines"
                : workflow.answer === "code"
                  ? "A change to the code, described in a sentence or two"
                  : "One block of text"
            }
            help="Part of how this job works rather than a preference, so it is fixed here and cannot drift from the code that parses it."
          />

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

          <div className="flex flex-col gap-5 rounded-lg border p-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Where the answer goes</p>
              <p className="text-xs text-muted-foreground">
                Usually back to whatever triggered the loop, which is what this started as. It does
                not have to be, and it does not have to be the same service.
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="loop-action-connector">Service</Label>
                <Select
                  value={actionConnectorId}
                  onValueChange={(value) =>
                    value && chooseAction(value, connectorManifest(value)!.actions[0]!.id)
                  }
                >
                  <SelectTrigger id="loop-action-connector" className="w-full">
                    <SelectValue>
                      {(value: string) => connectorManifest(value)?.name ?? value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {WRITERS.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="loop-action">What it does there</Label>
                <Select
                  value={actionId}
                  onValueChange={(value) => value && chooseAction(actionConnectorId, value)}
                >
                  <SelectTrigger id="loop-action" className="w-full">
                    <SelectValue>
                      {(value: string) =>
                        connectorAction(actionConnectorId, value)?.name ?? value
                      }
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
              </div>
            </div>

            {action ? <p className="text-xs text-muted-foreground">{action.summary}</p> : null}

            {/* Answering the thing that triggered the loop is only possible
                when the two are on the same service, so a loop that crosses
                has to be told where instead of being left to fail at the
                write. */}
            {action && actionConnectorId !== loop.connectorId ? (
              <Alert>
                <AlertTitle>This writes somewhere it did not read</AlertTitle>
                <AlertDescription>
                  {writerName} has no way to answer something on{" "}
                  {connector?.name ?? loop.connectorId}, so choose below where this should land.
                  Both accounts have to be connected for the loop to run.
                </AlertDescription>
              </Alert>
            ) : null}

            {action && workflow.answer === "review" && !action.accepts.includes("review") ? (
              <p className="text-xs text-muted-foreground">
                This cannot attach a comment to a line, so the review arrives as prose with the
                file and line of each point written into it. Nothing is dropped.
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
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loop-prompt">What the agent is asked to do</Label>
            <p className="text-xs text-muted-foreground">
              {fresh
                ? `Copied from “${workflow.name}”, and yours once you save. Editing it here changes nothing anywhere else, and a later version of that workflow will not change it back.`
                : `Copied from “${workflow.name}” when this loop was made, and yours now. Editing it here changes nothing anywhere else, and a later version of that workflow will not change it back.`}
            </p>
            <Textarea
              id="loop-prompt"
              rows={12}
              className="font-mono text-xs"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loop-guidance">Anything else the agent should know</Label>
            <p className="text-xs text-muted-foreground">
              Optional, and added after what you asked above. For a standing note about your team
              rather than about the job, so the two do not have to be untangled later.
            </p>
            <Textarea
              id="loop-guidance"
              rows={4}
              value={guidance}
              placeholder={workflow.guidancePlaceholder}
              onChange={(event) => setGuidance(event.target.value)}
            />
          </div>

          {/* Only the control is narrow. The help belongs to the section and
              reads as a column of three words a line inside a box this wide. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="loop-every">How often to look</Label>
            <p className="text-xs text-muted-foreground">
              Waiting longer is not only about being polite to the service. Anything that decides
              what deserves an agent by weighing a batch needs a batch to weigh, and looking
              constantly means finding one thing at a time and running all of them.
            </p>
            <Select value={pollEveryMs} onValueChange={(value) => value && setPollEveryMs(value)}>
              <SelectTrigger id="loop-every" className="w-full sm:max-w-xs">
                <SelectValue>
                  {(value: string) =>
                    POLL_CHOICES.find((choice) => choice.value === value)?.label ?? value
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
          </div>

          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="loop-agent">Run it with</Label>
            <Select value={agentId} onValueChange={(value) => value && setAgentId(value)}>
              <SelectTrigger id="loop-agent" className="w-full">
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
              <Label htmlFor="loop-enabled">Enabled</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                A disabled loop is kept but never matches.
              </p>
            </div>
            <Switch id="loop-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? (fresh ? "Adding..." : "Saving...") : fresh ? "Add loop" : "Save loop"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate({ to: fresh ? "/loops/new" : "/loops" })}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
