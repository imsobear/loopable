/**
 * When a scheduled loop should have run.
 *
 * Everything here works in local wall time, built through the Date constructor
 * rather than by adding milliseconds. "Every day at nine" means nine o'clock as
 * the clock on the wall reads it, and on the two days a year that a day is not
 * twenty-four hours long, arithmetic on milliseconds gets one of them wrong.
 */

export type Schedule =
  | { every: "hour"; minute: number }
  | { every: "day"; hour: number; minute: number }
  | { every: "weekday"; hour: number; minute: number }
  | { every: "week"; weekday: number; hour: number; minute: number };

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function parseTime(at: string): { hour: number; minute: number } {
  const match = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(at);
  if (!match) {
    throw new Error(`"${at}" is not a time. Write it as 09:00, on a 24-hour clock.`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`There is no such time as ${at}.`);
  }
  return { hour, minute };
}

/**
 * The schedule a loop's settings describe.
 *
 * Throws rather than falling back to a default, because a loop that was meant
 * to run at seven and quietly runs at midnight is worse than one that says it
 * cannot read its own settings.
 */
export function scheduleFrom(settings: Record<string, unknown>): Schedule {
  const every = typeof settings.every === "string" ? settings.every : "day";
  const at = typeof settings.at === "string" && settings.at.trim() !== "" ? settings.at : "09:00";

  if (every === "hour") return { every: "hour", minute: parseTime(at).minute };
  if (every === "day") return { every: "day", ...parseTime(at) };
  if (every === "weekday") return { every: "weekday", ...parseTime(at) };
  if (every === "week") {
    const raw = typeof settings.weekday === "string" ? Number(settings.weekday) : 1;
    const weekday = Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : 1;
    return { every: "week", weekday, ...parseTime(at) };
  }
  throw new Error(`Loopable does not know how to run something "${every}".`);
}

/** A local wall-clock time on the day `days` before `from`. */
function on(from: Date, days: number, hour: number, minute: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() - days, hour, minute, 0, 0);
}

/** Whether this schedule accepts a day, which only the weekday one restricts. */
function accepts(schedule: Schedule, when: Date): boolean {
  const day = when.getDay();
  if (schedule.every === "weekday") return day >= 1 && day <= 5;
  if (schedule.every === "week") return day === schedule.weekday;
  return true;
}

/**
 * The most recent time this schedule came round at or before `now`.
 *
 * Searched backwards a day at a time rather than computed, because "the last
 * weekday" and "the last Tuesday" are the same question asked of a calendar,
 * and a fortnight of candidates is nothing to look through.
 */
export function lastDue(schedule: Schedule, now: Date): Date {
  if (schedule.every === "hour") {
    const thisHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      schedule.minute,
      0,
      0,
    );
    if (thisHour <= now) return thisHour;
    return new Date(thisHour.getTime() - 60 * 60_000);
  }

  for (let days = 0; days < 15; days += 1) {
    const candidate = on(now, days, schedule.hour, schedule.minute);
    if (candidate <= now && accepts(schedule, candidate)) return candidate;
  }
  // Unreachable for the schedules that exist: a fortnight contains every
  // weekday twice over.
  throw new Error("Could not work out when this last came round.");
}

/**
 * The run owed since `after`, or null when none is.
 *
 * At most one, and the most recent, on purpose. A laptop shut for a week owes
 * a morning summary, not seven of them, and the one worth having is today's.
 * Which of the missed ones is chosen matters because the caller records it: the
 * older ones are passed over rather than queued behind it.
 */
export function dueSince(schedule: Schedule, after: Date, now: Date): Date | null {
  const last = lastDue(schedule, now);
  return last > after ? last : null;
}
