import { pollAllRules, type PollReport } from "./signals.ts";
import { runnerSettings } from "./settings.ts";

export type PollerOptions = {
  /** Swapped out in tests, where asking GitHub anything is not the point. */
  poll?: () => Promise<PollReport[]>;
  intervalMs?: number;
  log?: (message: string) => void;
};

export type Poller = ReturnType<typeof createPoller>;

/**
 * Asks every rule's connector what matches, over and over.
 *
 * Polling rather than webhooks because Loopable runs on a laptop: there is no
 * address for GitHub to call back, and asking is something a laptop can do
 * from behind any network. Two minutes is slow enough to stay far inside
 * GitHub's search limit and fast enough that a review request feels picked up
 * rather than found later.
 */
export function createPoller(options: PollerOptions = {}) {
  const run = options.poll ?? pollAllRules;
  const intervalMs = options.intervalMs ?? 120_000;
  const log = options.log ?? (() => {});

  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;

  /**
   * One pass over every rule. Never two at once: a slow pass would otherwise
   * overlap the next one and both would decide the same signal is new.
   */
  async function tick(): Promise<PollReport[]> {
    if (busy) return [];
    // Pausing is about not spending money on agent runs, and looking costs
    // none, but a paused engine that keeps queueing work would hand back a
    // pile of it the moment it resumed.
    if (runnerSettings().paused) return [];

    busy = true;
    try {
      const reports = await run();
      for (const report of reports) {
        if (report.error) {
          log(`poll ${report.ruleName}: ${report.error}`);
        } else if (report.queued || report.backlog || report.held || report.superseded) {
          const parts = [
            report.queued ? `${report.queued} queued` : null,
            report.backlog ? `${report.backlog} kept as backlog` : null,
            report.held ? `${report.held} held back` : null,
            report.superseded ? `${report.superseded} taken by an earlier rule` : null,
          ].filter(Boolean);
          log(`poll ${report.ruleName}: ${report.found} matching, ${parts.join(", ")}`);
        }
      }
      return reports;
    } catch (error) {
      log(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      busy = false;
    }
  }

  function start(): void {
    if (timer) return;
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { tick, start, stop, intervalMs };
}
