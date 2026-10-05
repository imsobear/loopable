import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getInbox, runPrompt } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/inbox/")({
  loader: () => getInbox(),
  component: InboxPage,
});

function InboxPage() {
  const { tasks, agents } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inbox" description="Every run, newest first." />
      <PromptBox agents={agents} />
      <TaskList tasks={tasks} empty="Nothing has run yet." />
    </div>
  );
}

/** Ask an agent something once. The reply stays here; nothing is written back. */
function PromptBox({ agents }: { agents: Array<{ agentId: string; name: string }> }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.agentId ?? "");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!agents.some((agent) => agent.agentId === agentId)) {
      setAgentId(agents[0]?.agentId ?? "");
    }
  }, [agents, agentId]);
  const canRun = Boolean(prompt.trim() && agentId && !running);

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      await runPrompt({ data: { prompt, agentId } });
      await router.invalidate();
      setPrompt("");
      toast.success("Queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 focus-within:ring-ring/50">
      <Textarea
        aria-label="Prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
        }}
        placeholder="Ask an agent something. The reply stays here."
        rows={2}
        className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-end gap-2 px-3 pb-3">
        {agents.length === 0 ? (
          <span className="mr-auto text-xs text-muted-foreground">No agent is online.</span>
        ) : (
          <Select value={agentId} onValueChange={(value) => value && setAgentId(value)}>
            <SelectTrigger aria-label="Agent" size="sm" className="w-auto">
              <SelectValue>
                {(value: string) => agents.find((agent) => agent.agentId === value)?.name ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.agentId} value={agent.agentId}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" onClick={run} disabled={!canRun}>
          <Play />
          {running ? "Queueing..." : "Run"}
        </Button>
      </div>
    </div>
  );
}
