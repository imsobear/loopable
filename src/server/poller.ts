import { pollAllLoops, type PollReport } from "./signals.ts";
import { dispatcherSettings } from "./settings.ts";

export type PollerOptions = {
  /** Swapped out in tests, where asking GitHub anything is not the point. */
  poll?: () => Promise<PollReport[]>;
  intervalMs?: number;
  log?: (message: string) => void;
};

export type Poller = ReturnType<typeof createPoller>;

/**
 * Asks every loop's connector what matches, over and over.
 *
 * Polling rather than webhooks for now: it needs nothing registered with each
 * service, and works the same for every connector. Each loop is only asked
 * when it is due, so this runs every minute, as often as a loop may ask; that
 * stays far inside GitHub's search limit and picks a review request up while
 * it is still fresh.
 */
export function createPoller(options: PollerOptions = {}) {
  const run = options.poll ?? pollAllLoops;
  const intervalMs = options.intervalMs ?? 60_000;
  const log = options.log ?? (() => {});

  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;

  /**
   * One pass over every loop. Never two at once: a slow pass would otherwise
   * overlap the next one and both would decide the same signal is new.
   */
  async function tick(): Promise<PollReport[]> {
    if (busy) return [];
    // Pausing is about not spending money on agent runs, and looking costs
    // none, but a paused dispatcher that keeps queueing work would hand back a
    // pile of it the moment it resumed.
    if ((await dispatcherSettings()).paused) return [];

    busy = true;
    try {
      const reports = await run();
      for (const report of reports) {
        if (report.error) {
          log(`poll ${report.loopName}: ${report.error}`);
        } else if (report.queued || report.backlog || report.held || report.superseded) {
          const parts = [
            report.queued ? `${report.queued} queued` : null,
            report.backlog ? `${report.backlog} kept as backlog` : null,
            // Named apart from the connector's own holds, because this is the
            // number that says whether one look is earning its keep.
            report.triaged ? `${report.triaged} not worth a run` : null,
            report.held - report.triaged > 0
              ? `${report.held - report.triaged} held back`
              : null,
            report.superseded ? `${report.superseded} taken by an earlier loop` : null,
          ].filter(Boolean);
          log(`poll ${report.loopName}: ${report.found} matching, ${parts.join(", ")}`);
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
