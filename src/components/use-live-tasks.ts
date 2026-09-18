import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { isTaskActive, type TaskState } from "@/lib/domain.ts";

/**
 * The work happens in the dispatcher, so the page has to go and look. Polling only
 * while something is actually running keeps an idle inbox quiet.
 */
export function useLiveTasks(states: Array<{ state: TaskState }>, everyMs = 2_000): void {
  useLiveRefresh(everyMs, states.some((task) => isTaskActive(task.state)));
}

/** Runner inventory changes without this page doing anything, so it looks again. */
export function useLiveRefresh(everyMs = 10_000, enabled = true): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => void router.invalidate(), everyMs);
    return () => clearInterval(timer);
  }, [enabled, everyMs, router]);
}
