import { createFileRoute, useRouter } from "@tanstack/react-router";
import { MessageSquarePlus, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
      <PageHeader
        title="Inbox"
        description="Every run, newest first."
        actions={<AskAgent agents={agents} />}
      />
      <TaskList tasks={tasks} empty="Nothing has run yet." />
    </div>
  );
}

/** Ask an agent something once. The reply stays in Inbox; nothing is written back. */
function AskAgent({ agents }: { agents: Array<{ agentId: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      toast.success("Queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <MessageSquarePlus />
        Ask an agent
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask an agent</DialogTitle>
          <DialogDescription>Runs once. The reply stays in Inbox.</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Prompt"
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
          }}
          placeholder="What should the agent do?"
          rows={5}
        />
        <DialogFooter className="items-center">
          {agents.length === 0 ? (
            <span className="mr-auto text-xs text-muted-foreground">No agent is online.</span>
          ) : (
            <Select value={agentId} onValueChange={(value) => value && setAgentId(value)}>
              <SelectTrigger aria-label="Agent" className="mr-auto w-auto">
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
          <Button onClick={run} disabled={!canRun}>
            <Play />
            {running ? "Queueing..." : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
