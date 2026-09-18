import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every run, in the order it happened, whether it wrote something or decided there was
          nothing to say.
        </p>
      </header>

      <PromptRunBox agents={agents} />

      <TaskList
        tasks={tasks}
        empty="Nothing has run yet. Try a prompt above, or open a loop and try it against a pull request or issue link."
      />

      {tasks.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/loops" className="underline">
            Go to loops
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function PromptRunBox({ agents }: { agents: Array<{ agentId: string; name: string }> }) {
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
    <Card>
      <CardHeader className="text-base font-medium">Run a prompt</CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="inbox-prompt">Prompt</Label>
          <Textarea
            id="inbox-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the agent something. The reply stays in Inbox; nothing is written back."
            rows={4}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="inbox-agent">Agent</Label>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Start a runner with an agent signed in, then you can run a prompt.
              </p>
            ) : (
              <Select value={agentId} onValueChange={(value) => value && setAgentId(value)}>
                <SelectTrigger id="inbox-agent" className="w-full sm:max-w-xs">
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
          </div>
          <Button onClick={run} disabled={!canRun || agents.length === 0}>
            <Play />
            {running ? "Queueing..." : "Run"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
