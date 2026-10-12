import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Server } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { approveRunner, getRunnerLogin } from "@/server/functions/runners.ts";

/**
 * Where `loopable login` sends someone: approve the code shown in the
 * terminal, and that machine joins this workspace as a runner.
 */
export const Route = createFileRoute("/runners/connect")({
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search.code === "string" ? { code: search.code } : {},
  loaderDeps: ({ search }) => ({ code: search.code ?? "" }),
  loader: async ({ deps }) => ({
    code: deps.code,
    ...(deps.code ? await getRunnerLogin({ data: { code: deps.code } }) : { state: "unknown" as const }),
  }),
  component: ConnectRunnerPage,
});

function ConnectRunnerPage() {
  const { code, state } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try {
      await approveRunner({ data: { code } });
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ to: "/runners", label: "Runners" }} title="Connect a runner" />
      <div className="flex max-w-md flex-col items-start gap-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        {state === "pending" ? (
          <>
            <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
              <Server className="size-5" />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">Check this matches the code in your terminal.</p>
              <p className="mt-2 font-mono text-2xl font-semibold tracking-widest">{code}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              That machine will run agents for this workspace.
            </p>
            <Button onClick={approve} disabled={busy}>
              {busy ? "Connecting..." : "Connect this runner"}
            </Button>
          </>
        ) : state === "approved" ? (
          <>
            <CheckCircle2 className="size-8 text-emerald-600" />
            <p className="text-sm">
              Connected. Go back to your terminal and run <code>loopable runner</code>.
            </p>
            <Button variant="outline" nativeButton={false} render={<Link to="/runners" />}>
              See runners
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {state === "expired"
              ? "This code has expired. Run loopable login again for a new one."
              : "There is no login waiting with this code. Run loopable login and use the link it shows."}
          </p>
        )}
      </div>
    </div>
  );
}
