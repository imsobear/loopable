import { CircleAlert, CirclePause, CirclePlay } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDispatcherState, pauseDispatcher } from "@/server/functions/tasks.ts";
import { cn } from "@/lib/utils";

export type DispatcherState = {
  alive: boolean;
  paused: boolean;
  maxConcurrentRuns: number;
  onlineRunners: number;
};

/**
 * The dispatcher can stop between two page loads and nothing on a page would
 * change, so this asks rather than waiting to be told.
 */
function useDispatcherState(everyMs = 10_000) {
  const [dispatcher, setDispatcher] = useState<DispatcherState | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDispatcher(await getDispatcherState());
    } catch {
      // A failed poll says nothing about the dispatcher, only about this request.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, refresh]);

  return { dispatcher, refresh };
}

/**
 * Runs are dispatched from this process, so a queued task that never moves
 * usually means it is not there. Saying so is the difference between a queue
 * and a thing that quietly swallows work.
 *
 * It lives in the sidebar because it is true of the whole app rather than of
 * whichever page is open, and because a page is the wrong place to learn that
 * nothing you do on it will happen.
 */
export function DispatcherStatus() {
  const { dispatcher, refresh } = useDispatcherState();
  const [busy, setBusy] = useState(false);

  // Nothing is known yet on the first paint. A dot that guesses green would be
  // worse than no dot at all.
  if (!dispatcher) return null;

  const down = !dispatcher.alive;

  const toggle = async () => {
    setBusy(true);
    try {
      await pauseDispatcher({ data: { paused: !dispatcher.paused } });
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
        !down && !dispatcher.paused
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
              dispatcher.paused ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
        )}
        <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
          {down ? "Dispatcher not running" : dispatcher.paused ? "Paused" : "Dispatcher running"}
        </span>
        {down ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={toggle}
            disabled={busy}
            title={dispatcher.paused ? "Resume" : "Pause"}
            className="size-6 shrink-0 group-data-[collapsible=icon]:hidden"
          >
            {dispatcher.paused ? <CirclePlay /> : <CirclePause />}
            <span className="sr-only">{dispatcher.paused ? "Resume" : "Pause"}</span>
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-snug opacity-80 group-data-[collapsible=icon]:hidden">
        {down ? (
          <>
            Queued tasks will wait until the dispatcher is running.
          </>
        ) : dispatcher.paused ? (
          "Nothing will run until you start it again."
        ) : (
          `${dispatcher.maxConcurrentRuns} run${dispatcher.maxConcurrentRuns === 1 ? "" : "s"} at a time${
            dispatcher.onlineRunners > 0
              ? ` · ${dispatcher.onlineRunners} runner${dispatcher.onlineRunners === 1 ? "" : "s"} online`
              : ""
          }.`
        )}
      </p>
    </div>
  );
}
