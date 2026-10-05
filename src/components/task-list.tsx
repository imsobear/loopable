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
} from "lucide-react";
import { agentManifest } from "@/agents/manifests.ts";
import { ConnectorIcon } from "@/components/connector-icon";
import { Badge } from "@/components/ui/badge";
import { Empty, List } from "@/components/page";
import { useLiveTasks } from "@/components/use-live-tasks.ts";
import { connectorManifest } from "@/connectors/manifests.ts";
import type { TaskState, TaskView, WorkItemKind } from "@/lib/domain.ts";
import { ago } from "@/lib/time.ts";
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
  prompt: "Test run",
};

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

  if (tasks.length === 0) return <Empty>{empty}</Empty>;

  return (
    <List>
      {tasks.map((task) => (
        <Link
          key={task.id}
          to="/inbox/$taskId"
          params={{ taskId: task.id }}
          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
        >
          {task.sourceKind === "prompt" ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Bot className="size-4" />
            </span>
          ) : (
            <ConnectorIcon
              icon={connectorManifest(task.connectorId)?.icon ?? "Plug"}
              accent={connectorManifest(task.connectorId)?.accent ?? "bg-muted"}
              className="size-7 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{taskTitle(task)}</p>
              {task.dryRun ? <Badge variant="outline">Dry run</Badge> : null}
              <TaskStateLabel state={task.state} />
            </div>
            <TaskMeta task={task} showLoop={showLoop} />
            {task.output ? (
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.output}</p>
            ) : task.error ? (
              <p className="mt-1 line-clamp-1 text-xs text-destructive">{task.error}</p>
            ) : null}
          </div>
        </Link>
      ))}
    </List>
  );
}

/** One quiet line: which item, which loop, which agent, when. */
function TaskMeta({ task, showLoop }: { task: TaskView; showLoop: boolean }) {
  const agent = task.agentId ? agentManifest(task.agentId) : undefined;
  const parts = [
    // "acme/web#7" says where the work is; a mail or message id says nothing.
    NAMED_REF.has(task.sourceKind) && task.sourceTitle ? task.sourceRef : null,
    showLoop ? task.loopName : null,
    agent?.name,
    ago(task.createdAt),
  ].filter(Boolean);
  return <p className="mt-0.5 truncate text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}
