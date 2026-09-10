import type { ConnectorRuntime, Signal, WorkItem } from "../types.ts";
import { dueSince, scheduleFrom } from "./schedule.ts";

/** How a time is written where a person will read it back. */
function readable(when: Date): string {
  return when.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function signalFor(due: Date): Signal {
  return {
    kind: "occurrence",
    // Stable for this occurrence and only this one, which is what stops a
    // second look in the same minute running it again.
    key: due.toISOString(),
    ref: readable(due),
    title: `Due ${readable(due)}`,
    // A time has no address. Handled everywhere a source link is shown,
    // because a chat message has none either.
    url: "",
    // Kept because it cannot be worked out again later. A run that was owed
    // from nine and starts at eleven, because the machine was shut, is about
    // nine; there is nothing at the other end to ask.
    payload: { due: due.toISOString() },
  };
}

export const scheduleRuntime: ConnectorRuntime = {
  /** Nothing to register and nothing to install: a clock is always ready. */
  async readiness() {
    return { ready: true };
  },

  /**
   * There is no account, so none of this is reachable. `identity` is required
   * of every connector because every other one has a stored credential to
   * prove still works, and this one has nothing to prove.
   */
  auth: {
    async identity() {
      throw new Error("A schedule has no account.");
    },
  },

  /**
   * Whether a time has come round since the last one that did.
   *
   * The cursor is the occurrence this loop last fired, and it moves only when
   * one fires. On a first look there is nothing to compare against, so the
   * cursor is set to now and nothing is returned: turning a loop on should not
   * immediately run this morning's, which is what would happen if the last
   * occurrence counted as owed.
   */
  async poll({ settings, cursor }) {
    const schedule = scheduleFrom(settings);
    const now = new Date();

    const since = typeof cursor === "string" ? new Date(cursor) : null;
    if (!since || Number.isNaN(since.getTime())) {
      return { signals: [], cursor: now.toISOString() };
    }

    const due = dueSince(schedule, since, now);
    if (!due) return { signals: [], cursor: cursor ?? undefined };
    return { signals: [signalFor(due)], cursor: due.toISOString() };
  },

  /**
   * A run somebody asked for is about the moment they asked, not about the
   * last time the clock came round. Waiting until nine tomorrow to find out
   * whether a loop works is no way to shape one.
   */
  itemForNow() {
    const now = new Date();
    return { kind: "occurrence" as const, ref: readable(now) };
  },

  /**
   * Writes nothing anywhere.
   *
   * Which is worth having as an action rather than as a gap, because a loop
   * needs somewhere for its answer to go before it will run at all, and until
   * a reliable destination exists this is the honest one: every run is already
   * recorded, so the answer is kept where a person will look for it. Returns
   * no address because the task's own page is the address.
   */
  async applyAction({ actionId }) {
    if (actionId !== "schedule.record") throw new Error(`A schedule cannot ${actionId}.`);
    return { url: "" };
  },

  /**
   * There is nothing to fetch: the occurrence is the whole of what happened,
   * and the poll already wrote it down. Anything run from the button rather
   * than by the clock has no occurrence behind it and is about now.
   */
  async resolveWorkItem({ payload }): Promise<WorkItem> {
    const due =
      payload && typeof payload === "object" && "due" in payload && typeof payload.due === "string"
        ? new Date(payload.due)
        : new Date();
    return { ...signalFor(due), context: [] };
  },
};
