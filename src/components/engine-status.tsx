import { useRouter } from "@tanstack/react-router";
import { CircleAlert, CirclePause, CirclePlay } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pauseRunner } from "@/server/functions/tasks.ts";
import { cn } from "@/lib/utils";

export type EngineState = {
  daemonPid: number | null;
  paused: boolean;
  maxConcurrentRuns: number;
};

/**
 * Runs happen in the daemon, so a queued task that never moves usually means
 * the engine is not there. Saying so is the difference between a queue and a
 * thing that quietly swallows work.
 */
export function EngineStatus({ engine, quiet }: { engine: EngineState; quiet?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const healthy = engine.daemonPid !== null && !engine.paused;

  if (quiet && healthy) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      await pauseRunner({ data: { paused: !engine.paused } });
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
        healthy ? "text-muted-foreground" : "border-amber-500/40 bg-amber-500/5",
      )}
    >
      {engine.daemonPid === null ? (
        <>
          <CircleAlert className="size-4 shrink-0 text-amber-600" />
          <span className="flex-1">
            The engine is not running, so queued tasks will wait. Start it with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">pnpm daemon</code>.
          </span>
        </>
      ) : engine.paused ? (
        <>
          <CirclePause className="size-4 shrink-0 text-amber-600" />
          <span className="flex-1">Paused. Nothing will run until you start it again.</span>
          <Button size="sm" variant="outline" onClick={toggle} disabled={busy}>
            <CirclePlay />
            Resume
          </Button>
        </>
      ) : (
        <>
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="flex-1">
            Engine running, {engine.maxConcurrentRuns} at a time.
          </span>
          <Button size="sm" variant="ghost" onClick={toggle} disabled={busy}>
            <CirclePause />
            Pause
          </Button>
        </>
      )}
    </div>
  );
}
