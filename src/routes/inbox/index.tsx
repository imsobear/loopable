import { Link, createFileRoute } from "@tanstack/react-router";
import { TaskList } from "@/components/task-list";
import { getInbox } from "@/server/functions/tasks.ts";

export const Route = createFileRoute("/inbox/")({
  loader: async () => ({ tasks: await getInbox() }),
  component: InboxPage,
});

function InboxPage() {
  const { tasks } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every run, in the order it happened, whether it wrote something or decided there was
          nothing to say.
        </p>
      </header>

      <TaskList
        tasks={tasks}
        empty="Nothing has run yet. Open a rule and try it against a pull request or issue link."
      />

      {tasks.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/rules" className="underline">
            Go to rules
          </Link>
        </p>
      ) : null}
    </div>
  );
}
