import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Bot, ChevronDown, MousePointerClick, PlayCircle, Terminal, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { AGENT_MANIFESTS } from "@/agents/manifests.ts";
import type { AgentManifest, PermissionMode } from "@/agents/types.ts";
import { cn } from "@/lib/utils";
import type { AgentView } from "@/lib/domain.ts";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import {
  chooseDefaultAgent,
  getAgentsPage,
  runAgentTest,
  saveAgent,
} from "@/server/functions/agents.ts";

const ICONS: Record<string, LucideIcon> = { Terminal, MousePointerClick, Bot };

const MODE_LABELS: Record<PermissionMode, string> = {
  read_only: "Read only",
  workspace_write: "Can write in the workspace",
};

export const Route = createFileRoute("/agents/")({
  loader: () => getAgentsPage(),
  component: AgentsPage,
});

export function AgentsPage() {
  const { agents } = Route.useLoaderData();
  useLiveRefresh();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The coding CLIs Loopable knows how to run. Presence comes from runners. Settings here are
          how every runner invokes that CLI.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {AGENT_MANIFESTS.map((manifest) => {
          const view = agents.find((agent) => agent.agentId === manifest.id);
          return view ? <AgentRow key={manifest.id} manifest={manifest} view={view} /> : null;
        })}
      </div>
    </div>
  );
}

function presence(view: AgentView): string {
  const signedIn = view.onRunners.filter((runner) => runner.signedIn);
  const online = signedIn.filter((runner) => runner.status === "online");
  if (online.length > 0) {
    return online.length === 1
      ? `Signed in on ${online[0]!.name}`
      : `Signed in on ${online.length} runners`;
  }
  if (signedIn.length > 0) return "Signed in, but every runner is offline";
  if (view.onRunners.length > 0) return "Installed, not signed in";
  return "Not on any runner";
}

function AgentRow({ manifest, view }: { manifest: AgentManifest; view: AgentView }) {
  const router = useRouter();
  const Icon = ICONS[manifest.icon] ?? Bot;
  const [open, setOpen] = useState(view.isDefault && !view.defaultIsImplicit);
  const [mode, setMode] = useState<PermissionMode>(view.settings.permissionMode);
  const [model, setModel] = useState(view.settings.model ?? "");
  const [seconds, setSeconds] = useState(String(Math.round(view.settings.timeoutMs / 1000)));
  const [busy, setBusy] = useState<"save" | "default" | "test" | null>(null);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const online = view.onRunners.some((runner) => runner.signedIn && runner.status === "online");

  const act = async (kind: "save" | "default" | "test", run: () => Promise<void>) => {
    setBusy(kind);
    try {
      await run();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3 p-4">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
            online ? manifest.accent : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{manifest.name}</span>
            {view.isDefault ? (
              <Badge>{view.defaultIsImplicit ? "Default (only one signed in)" : "Default"}</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{presence(view)}</p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {!view.isDefault ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                act("default", async () => {
                  await chooseDefaultAgent({ data: { agentId: manifest.id } });
                  await router.invalidate();
                  toast.success(`${manifest.name} will run the loops`);
                })
              }
            >
              Default
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-label="Settings"
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {open ? (
        <CardContent className="flex flex-col gap-4 border-t pt-4">
          <p className="text-sm text-muted-foreground">{manifest.tagline}</p>
          {!online ? <p className="text-sm text-muted-foreground">{manifest.installHint}</p> : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${manifest.id}-mode`}>Permission</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as PermissionMode)}>
                <SelectTrigger id={`${manifest.id}-mode`} className="w-full">
                  <SelectValue>
                    {(value: PermissionMode) => MODE_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {manifest.permissionModes.map((value) => (
                    <SelectItem key={value} value={value}>
                      {MODE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {manifest.supportsModel ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${manifest.id}-model`}>Model</Label>
                <Input
                  id={`${manifest.id}-model`}
                  value={model}
                  placeholder={manifest.modelPlaceholder}
                  onChange={(event) => setModel(event.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${manifest.id}-timeout`}>Timeout (seconds)</Label>
              <Input
                id={`${manifest.id}-timeout`}
                value={seconds}
                inputMode="numeric"
                onChange={(event) => setSeconds(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>

          <pre className="overflow-x-auto rounded-md bg-muted p-2.5 text-xs">{view.commandPreview}</pre>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                act("save", async () => {
                  await saveAgent({
                    data: {
                      agentId: manifest.id,
                      permissionMode: mode,
                      model: model.trim() ? model.trim() : null,
                      timeoutMs: Number(seconds) * 1000,
                    },
                  });
                  await router.invalidate();
                  toast.success(`Saved ${manifest.name} settings`);
                })
              }
            >
              {busy === "save" ? "Saving..." : "Save"}
            </Button>
            {view.installed ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  act("test", async () => {
                    setTestOutput(null);
                    const result = await runAgentTest({ data: { agentId: manifest.id } });
                    setTestOutput(
                      result.passed
                        ? `Answered correctly in ${(result.durationMs / 1000).toFixed(1)}s.`
                        : `${result.detail ?? "The agent did not answer as expected."}\n${result.output}`.trim(),
                    );
                    if (result.passed) toast.success(`${manifest.name} is working`);
                    else toast.error(`${manifest.name} did not pass`);
                  })
                }
              >
                <PlayCircle />
                {busy === "test" ? "Running..." : "Test"}
              </Button>
            ) : null}
          </div>
          {testOutput ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{testOutput}</p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
