import { Link } from "@tanstack/react-router";
import {
  Bot,
  CircleCheck,
  CircleMinus,
  CircleSlash,
  CircleX,
  Clock,
  FileText,
  Loader,
  Plug,
  Workflow,
} from "lucide-react";
import { agentManifest } from "@/agents/manifests.ts";
import { ConnectorIcon } from "@/components/connector-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLiveTasks } from "@/components/use-live-tasks.ts";
import { connectorManifest } from "@/connectors/manifests.ts";
import type { TaskState, TaskView, WorkItemKind } from "@/lib/domain.ts";
import { cn } from "@/lib/utils";

const STATES: Record<
  TaskState,
  { label: string; icon: typeof CircleCheck; tone: string }
> = {
  queued: { label: "Queued", icon: Clock, tone: "text-muted-foreground" },
  preparing: { label: "Working", icon: Loader, tone: "text-muted-foreground" },
  awaiting_agent: { label: "On a runner", icon: Bot, tone: "text-muted-foreground" },
  applying: { label: "Writing", icon: Loader, tone: "text-muted-foreground" },
  prepared: { label: "Prepared", icon: FileText, tone: "text-muted-foreground" },
  done: { label: "Written", icon: CircleCheck, tone: "text-emerald-600" },
  skipped: { label: "Nothing to say", icon: CircleMinus, tone: "text-muted-foreground" },
  failed: { label: "Failed", icon: CircleX, tone: "text-destructive" },
  cancelled: { label: "Stopped", icon: CircleSlash, tone: "text-muted-foreground" },
};

export function TaskStateLabel({ state }: { state: TaskState }) {
  const meta = STATES[state];
  const Icon = meta.icon;
  const spinning = state === "preparing" || state === "awaiting_agent" || state === "applying";
  return (
    <span className={cn("flex items-center gap-1.5 text-xs", meta.tone)}>
      <Icon className={cn("size-3.5", spinning && "animate-spin")} />
      {meta.label}
    </span>
  );
}

/** A queued task has no title yet: the connector has not fetched it. */
export function taskTitle(task: Pick<TaskView, "sourceTitle" | "sourceRef">) {
  return task.sourceTitle ?? task.sourceRef;
}

/**
 * Kinds whose reference a person can read. A repository and a number say
 * where the work is; a mail or a message id is a handle for fetching it
 * again and means nothing on a page.
 */
const NAMED_REF = new Set<WorkItemKind>(["pull_request", "issue"]);

/** What to call the thing a task is about, where a sentence needs a noun. */
export const KIND_LABEL: Record<WorkItemKind, string> = {
  pull_request: "Pull request",
  issue: "Issue",
  message: "Message",
  email: "Email",
  occurrence: "Scheduled run",
};

function when(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function TaskList({
  tasks,
  showLoop = true,
  empty,
}: {
  tasks: TaskView[];
  showLoop?: boolean;
  empty: string;
}) {
  useLiveTasks(tasks);

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">{empty}</CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <Link
          key={task.id}
          to="/inbox/$taskId"
          params={{ taskId: task.id }}
          className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40"
        >
          <div className="flex items-start gap-3">
            <ConnectorIcon
              icon={connectorManifest(task.connectorId)?.icon ?? "Plug"}
              accent={connectorManifest(task.connectorId)?.accent ?? "bg-muted"}
              className="mt-0.5 size-7 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{taskTitle(task)}</p>
              {/* Only where it says something. "acme/web#7" is which change,
                  on which repository; "mail#1a083e9c7f407c82" is an id, and a
                  line of those down the page is a line of noise between every
                  title and what happened to it. */}
              {NAMED_REF.has(task.sourceKind) && task.sourceTitle ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.sourceRef}</p>
              ) : null}
              <TaskMeta task={task} showLoop={showLoop} />
              {/* Indented with the title rather than spanning the card. Out
                  here it began under the icon and ran the full width, which
                  is a line long enough that the eye loses its place coming
                  back, for the one part of the row worth actually reading. */}
              {task.output ? (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{task.output}</p>
              ) : task.error ? (
                <p className="mt-2 line-clamp-2 text-xs text-destructive">{task.error}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {task.dryRun ? <Badge variant="outline">Dry run</Badge> : null}
              <TaskStateLabel state={task.state} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * What ran, and what it ran through. Which agent wrote the words matters when
 * two loops disagree, and it is only known once the engine has picked the task
 * up, so it is absent rather than wrong while a task is queued.
 */
function TaskMeta({ task, showLoop }: { task: TaskView; showLoop: boolean }) {
  const connector = connectorManifest(task.connectorId);
  const agent = task.agentId ? agentManifest(task.agentId) : undefined;

  const parts: Array<{ icon: typeof Workflow; label: string }> = [];
  if (showLoop) parts.push({ icon: Workflow, label: task.loopName });
  if (connector) parts.push({ icon: Plug, label: connector.name });
  if (agent) parts.push({ icon: Bot, label: agent.name });
  parts.push({ icon: Clock, label: when(task.createdAt) });

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {parts.map((part) => (
        <span key={part.label} className="flex min-w-0 items-center gap-1">
          <part.icon className="size-3 shrink-0" />
          <span className="truncate">{part.label}</span>
        </span>
      ))}
    </div>
  );
}
