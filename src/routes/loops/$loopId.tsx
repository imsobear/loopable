import { createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CircleAlert, Play, RefreshCw, Trash2 } from "lucide-react";
import { ConnectorIcon } from "@/components/connector-icon";
import { LoopForm } from "@/components/loop-form";
import { LinkTabs, List, PageHeader, Section } from "@/components/page";
import { TaskList } from "@/components/task-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { agentManifest } from "@/agents/manifests.ts";
import { connectorManifest, destinationLabel } from "@/connectors/manifests.ts";
import type { LoopPollState, LoopView } from "@/lib/domain.ts";
import { issuesFor } from "@/lib/gaps.ts";
import { ago } from "@/lib/time.ts";
import { useLiveRefresh } from "@/components/use-live-tasks.ts";
import {
  getLoopById,
  getLoopPollState,
  getLoopReadiness,
  lookLoopNow,
  removeLoop,
  runLoopBacklog,
  toggleLoop,
} from "@/server/functions/loops.ts";
import { getLoopTasks, runLoopNow } from "@/server/functions/tasks.ts";

type Tab = "tasks" | "settings";

export const Route = createFileRoute("/loops/$loopId")({
  // The tab lives in the URL so either one can be linked to. Tasks is the
  // default and stays out of the URL.
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    search.tab === "settings" ? { tab: "settings" } : {},
  loader: async ({ params }) => {
    const loop = await getLoopById({ data: { id: params.loopId } });
    if (!loop) throw notFound();
    return {
      loop,
      tasks: await getLoopTasks({ data: { loopId: params.loopId } }),
      poll: await getLoopPollState({ data: { id: params.loopId } }),
      readiness: await getLoopReadiness(),
    };
  },
  component: LoopPage,
});

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const message = await work();
      await router.invalidate();
      if (message) toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function LoopPage() {
  const { loop, tasks, poll, readiness } = Route.useLoaderData();
  const { tab = "tasks" } = Route.useSearch();
  useLiveRefresh();
  const issues = issuesFor(readiness, loop);
  const connector = connectorManifest(loop.connectorId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: "/loops", label: "Loops" }}
        icon={connector ? <ConnectorIcon icon={connector.icon} accent={connector.accent} /> : null}
        title={loop.name}
        actions={<HeaderActions loop={loop} />}
      >
        <Summary loop={loop} poll={poll} />
      </PageHeader>

      {issues.length > 0 ? (
        <Alert>
          <CircleAlert />
          <AlertTitle>Cannot run yet</AlertTitle>
          <AlertDescription className="flex flex-col gap-0.5">
            {issues.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      {loop.enabled && poll.pollError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>The last check failed</AlertTitle>
          <AlertDescription>{poll.pollError}</AlertDescription>
        </Alert>
      ) : null}

      <LinkTabs
        items={[
          {
            label: (
              <>
                Tasks
                {tasks.length > 0 ? (
                  <span className="text-xs text-muted-foreground">{tasks.length}</span>
                ) : null}
              </>
            ),
            to: "/loops/$loopId",
            params: { loopId: loop.id },
            search: {},
            active: tab === "tasks",
          },
          {
            label: "Settings",
            to: "/loops/$loopId",
            params: { loopId: loop.id },
            search: { tab: "settings" },
            active: tab === "settings",
          },
        ]}
      />

      {tab === "settings" ? (
        <div className="flex flex-col">
          <LoopForm key={loop.id} loop={loop} />
          <DeleteLoop loop={loop} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Backlog loop={loop} poll={poll} />
          <TryOnLink loop={loop} />
          <TaskList tasks={tasks} showLoop={false} empty="No runs yet." />
        </div>
      )}
    </div>
  );
}

/** One line under the title: where it answers, with what, and when it last looked. */
function Summary({ loop, poll }: { loop: LoopView; poll: LoopPollState }) {
  const agent = loop.agentId ? agentManifest(loop.agentId) : undefined;
  const parts = [
    destinationLabel(loop.actionConnectorId, loop.actionId),
    agent?.name ?? "Default agent",
    loop.enabled ? (poll.polledAt ? `Checked ${ago(poll.polledAt)}` : "Not checked yet") : null,
  ].filter(Boolean);

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      {loop.enabled ? null : <Badge variant="secondary">Off</Badge>}
      {parts.join(" · ")}
    </p>
  );
}

function HeaderActions({ loop }: { loop: LoopView }) {
  const { busy, run } = useAction();
  const byHand = connectorManifest(loop.connectorId)?.byHand.kind ?? "none";

  return (
    <>
      {byHand === "now" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            run("run", async () => {
              await runLoopNow({ data: { loopId: loop.id, url: "", dryRun: false } });
              return "Queued";
            })
          }
        >
          <Play />
          Run now
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || !loop.enabled}
          onClick={() =>
            run("look", async () => {
              const report = await lookLoopNow({ data: { id: loop.id } });
              if (report.error) throw new Error(report.error);
              return "Checked";
            })
          }
        >
          <RefreshCw className={busy === "look" ? "animate-spin" : undefined} />
          Check now
        </Button>
      )}
      <label className="flex items-center gap-2 pl-1 text-sm">
        <Switch
          checked={loop.enabled}
          disabled={busy !== null}
          onCheckedChange={(enabled) =>
            run("toggle", async () => {
              await toggleLoop({ data: { id: loop.id, enabled } });
              return enabled ? "Turned on" : "Turned off";
            })
          }
        />
        {loop.enabled ? "On" : "Off"}
      </label>
    </>
  );
}

/** What matched but was not run: already there when the loop was made, or held back. */
function Backlog({ loop, poll }: { loop: LoopView; poll: LoopPollState }) {
  const { busy, run } = useAction();
  if (poll.backlog.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        Waiting <span className="font-normal text-muted-foreground">· matched, not run</span>
      </p>
      <List>
        {poll.backlog.map((item) => (
          <div key={item.key} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1 truncate text-sm">
              <span className="text-muted-foreground">{item.sourceRef}</span> {item.sourceTitle}
              {item.hold ? (
                <span className="text-xs text-amber-700 dark:text-amber-500"> · {item.hold}</span>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run(item.key, async () => {
                  await runLoopBacklog({ data: { id: loop.id, key: item.key } });
                  return "Queued";
                })
              }
            >
              <Play />
              Run
            </Button>
          </div>
        ))}
      </List>
    </div>
  );
}

/** Run the loop on one link, by hand, without waiting for something to arrive. */
function TryOnLink({ loop }: { loop: LoopView }) {
  const { busy, run } = useAction();
  const [url, setUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const manifest = connectorManifest(loop.connectorId);
  if (manifest?.byHand.kind !== "link") return null;

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        void run("try", async () => {
          await runLoopNow({ data: { loopId: loop.id, url: url.trim(), dryRun } });
          setUrl("");
          return dryRun ? "Queued as a dry run" : "Queued";
        });
      }}
    >
      <Input
        aria-label={`${manifest.name} link`}
        value={url}
        placeholder={`Try on a link: ${manifest.byHand.placeholder}`}
        onChange={(event) => setUrl(event.target.value)}
        className="flex-1"
      />
      <div className="flex items-center gap-3">
        <Label className="flex items-center gap-2 font-normal text-muted-foreground">
          <Switch checked={dryRun} onCheckedChange={setDryRun} />
          Dry run
        </Label>
        <Button type="submit" disabled={busy !== null || url.trim() === ""}>
          <Play />
          Run
        </Button>
      </div>
    </form>
  );
}

function DeleteLoop({ loop }: { loop: LoopView }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  return (
    <Section title="Delete" className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Its runs are deleted with it.</p>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Delete ${loop.name}?`)) return;
            setBusy(true);
            try {
              await removeLoop({ data: { id: loop.id } });
              toast.success(`Deleted ${loop.name}`);
              await navigate({ to: "/loops" });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error));
              setBusy(false);
            }
          }}
        >
          <Trash2 />
          Delete loop
        </Button>
      </div>
    </Section>
  );
}
