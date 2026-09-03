import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  CircleCheck,
  CircleAlert,
  MousePointerClick,
  PlayCircle,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  chooseDefaultAgent,
  getAgents,
  runAgentTest,
  saveAgent,
} from "@/server/functions/agents.ts";

const ICONS: Record<string, LucideIcon> = { Terminal, MousePointerClick, Bot };

const MODE_LABELS: Record<PermissionMode, string> = {
  read_only: "Read only",
  workspace_write: "Can write in the workspace",
};

export const Route = createFileRoute("/agents/")({
  loader: () => getAgents(),
  component: AgentsPage,
});

/**
 * The agent that actually runs the loops first, then the rest of what is on the
 * machine, then what could be. Manifest order only decides ties.
 */
function rank(view: AgentView | undefined): number {
  if (!view) return 3;
  if (view.isDefault) return 0;
  return view.installed ? 1 : 2;
}

function AgentsPage() {
  const agents = Route.useLoaderData();
  const installed = agents.filter((agent) => agent.installed);
  const ordered = AGENT_MANIFESTS.map((manifest) => ({
    manifest,
    view: agents.find((agent) => agent.agentId === manifest.id),
  })).sort((a, b) => rank(a.view) - rank(b.view));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Loopable uses the coding agents already installed on this machine. Nothing to install here,
          and no credentials of ours are ever passed to an agent.
        </p>
      </header>

      {installed.length === 0 ? (
        <Alert>
          <AlertDescription>
            No supported agent was found on this machine. Install one below, then reload this page.
          </AlertDescription>
        </Alert>
      ) : null}

      {ordered.map(({ manifest, view }) =>
        view ? <AgentCard key={manifest.id} manifest={manifest} view={view} /> : null,
      )}
    </div>
  );
}

function AgentCard({ manifest, view }: { manifest: AgentManifest; view: AgentView }) {
  const router = useRouter();
  const Icon = ICONS[manifest.icon] ?? Bot;

  const [mode, setMode] = useState<PermissionMode>(view.settings.permissionMode);
  const [model, setModel] = useState(view.settings.model ?? "");
  const [seconds, setSeconds] = useState(String(Math.round(view.settings.timeoutMs / 1000)));
  const [busy, setBusy] = useState<"save" | "default" | "test" | null>(null);
  const [testOutput, setTestOutput] = useState<string | null>(null);

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

  const save = () =>
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
    });

  const makeDefault = () =>
    act("default", async () => {
      await chooseDefaultAgent({ data: { agentId: manifest.id } });
      await router.invalidate();
      toast.success(`${manifest.name} will run the loops`);
    });

  const test = () =>
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
    });

  return (
    <Card className={cn(!view.installed && "opacity-75")}>
      <CardHeader className="flex flex-row items-start gap-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            view.installed ? manifest.accent : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{manifest.name}</h2>
            {view.isDefault ? (
              <Badge>{view.defaultIsImplicit ? "Default (only one installed)" : "Default"}</Badge>
            ) : null}
            {view.installed ? (
              <Badge variant="outline">{view.version}</Badge>
            ) : (
              <Badge variant="secondary">Not installed</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{manifest.tagline}</p>
          {view.installed && view.auth ? (
            <p
              className={cn(
                "mt-2 flex items-center gap-1.5 text-xs",
                view.auth.signedIn ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {view.auth.signedIn ? (
                <CircleCheck className="size-3.5" />
              ) : (
                <CircleAlert className="size-3.5" />
              )}
              {view.auth.detail}
            </p>
          ) : null}
        </div>
        {view.installed && !view.isDefault ? (
          <Button variant="outline" size="sm" onClick={makeDefault} disabled={busy !== null}>
            Use by default
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-5 border-t pt-5">
        {!view.installed ? (
          <p className="text-sm text-muted-foreground">{manifest.installHint}</p>
        ) : (
          <>
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

            <div>
              <p className="text-xs text-muted-foreground">This is what Loopable will run:</p>
              <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted p-2.5 text-xs">
                {view.commandPreview}
              </pre>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={busy !== null}>
                {busy === "save" ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={test} disabled={busy !== null}>
                <PlayCircle />
                {busy === "test" ? "Running..." : "Test"}
              </Button>
              <span className="text-xs text-muted-foreground">
                A test is a real run and costs whatever the agent normally costs.
              </span>
            </div>

            {testOutput ? (
              <Alert>
                <AlertDescription className="whitespace-pre-wrap">{testOutput}</AlertDescription>
              </Alert>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Found at <code>{view.binaryPath}</code>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
