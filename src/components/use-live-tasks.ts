import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { isTaskActive, type TaskState } from "@/lib/domain.ts";

/**
 * The work happens in the daemon, so the page has to go and look. Polling only
 * while something is actually running keeps an idle inbox quiet.
 */
export function useLiveTasks(states: Array<{ state: TaskState }>, everyMs = 2_000): void {
  const router = useRouter();
  const active = states.some((task) => isTaskActive(task.state));

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void router.invalidate(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
}
