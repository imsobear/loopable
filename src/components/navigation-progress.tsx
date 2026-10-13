import { useRouterState } from "@tanstack/react-router";

/**
 * A thin bar along the top while the next page loads, so a moment's wait
 * reads as loading rather than as a click that did nothing. It only shows if
 * the wait outlasts a fifth of a second.
 */
export function NavigationProgress() {
  const loading = useRouterState({ select: (state) => state.status === "pending" });
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
      style={{
        opacity: loading ? 1 : 0,
        transition: loading ? "opacity 150ms 200ms" : "opacity 150ms",
      }}
    >
      {loading ? <div className="h-full w-1/3 animate-[nav-progress_1.1s_ease-in-out_infinite] bg-primary" /> : null}
    </div>
  );
}
