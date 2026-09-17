import { CircleAlert, CirclePause, CirclePlay } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getEngineState, pauseEngine } from "@/server/functions/tasks.ts";
import { cn } from "@/lib/utils";

export type EngineState = {
  enginePid: number | null;
  paused: boolean;
  maxConcurrentRuns: number;
  onlineRunners: number;
};

/**
 * The engine can stop between two page loads and nothing on a page would
 * change, so this asks rather than waiting to be told.
 */
function useEngineState(everyMs = 10_000) {
  const [engine, setEngine] = useState<EngineState | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEngine(await getEngineState());
    } catch {
      // A failed poll says nothing about the engine, only about this request.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, refresh]);

  return { engine, refresh };
}

/**
 * Runs happen in the engine, so a queued task that never moves usually means
 * the engine is not there. Saying so is the difference between a queue and a
 * thing that quietly swallows work.
 *
 * It lives in the sidebar because it is true of the whole app rather than of
 * whichever page is open, and because a page is the wrong place to learn that
 * nothing you do on it will happen.
 */
export function EngineStatus() {
  const { engine, refresh } = useEngineState();
  const [busy, setBusy] = useState(false);

  // Nothing is known yet on the first paint. A dot that guesses green would be
  // worse than no dot at all.
  if (!engine) return null;

  const down = engine.enginePid === null;

  const toggle = async () => {
    setBusy(true);
    try {
      await pauseEngine({ data: { paused: !engine.paused } });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-xs",
        // Collapsed to icons there is room for the dot and nothing else.
        "group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0",
        !down && !engine.paused
          ? "text-muted-foreground"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-500",
      )}
    >
      <div className="flex items-center gap-2">
        {down ? (
          <CircleAlert className="size-3.5 shrink-0" />
        ) : (
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              engine.paused ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
        )}
        <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
          {down ? "Engine not running" : engine.paused ? "Paused" : "Engine running"}
        </span>
        {down ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={toggle}
            disabled={busy}
            title={engine.paused ? "Resume" : "Pause"}
            className="size-6 shrink-0 group-data-[collapsible=icon]:hidden"
          >
            {engine.paused ? <CirclePlay /> : <CirclePause />}
            <span className="sr-only">{engine.paused ? "Resume" : "Pause"}</span>
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-snug opacity-80 group-data-[collapsible=icon]:hidden">
        {down ? (
          <>
            Queued tasks will wait. Start it with{" "}
            <code className="rounded bg-muted px-1 py-0.5">pnpm engine</code>.
          </>
        ) : engine.paused ? (
          "Nothing will run until you start it again."
        ) : (
          `${engine.maxConcurrentRuns} run${engine.maxConcurrentRuns === 1 ? "" : "s"} at a time${
            engine.onlineRunners > 0
              ? ` · ${engine.onlineRunners} runner${engine.onlineRunners === 1 ? "" : "s"} online`
              : ""
          }.`
        )}
      </p>
    </div>
  );
}
