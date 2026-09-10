import { describe, expect, it } from "vitest";
import { dueSince, lastDue, scheduleFrom, type Schedule } from "./schedule.ts";

/** Local wall time, which is the only kind this module deals in. */
function at(text: string): Date {
  const [date, time] = text.split(" ");
  const [y, m, d] = date!.split("-").map(Number);
  const [hh, mm] = time!.split(":").map(Number);
  return new Date(y!, m! - 1, d!, hh!, mm!, 0, 0);
}

const daily: Schedule = { every: "day", hour: 9, minute: 0 };

describe("reading a schedule off a loop", () => {
  it("takes the ordinary case", () => {
    expect(scheduleFrom({ every: "day", at: "07:30" })).toEqual({
      every: "day",
      hour: 7,
      minute: 30,
    });
    expect(scheduleFrom({ every: "week", at: "18:05", weekday: "5" })).toEqual({
      every: "week",
      weekday: 5,
      hour: 18,
      minute: 5,
    });
    // Only the minute means anything hourly.
    expect(scheduleFrom({ every: "hour", at: "09:20" })).toEqual({ every: "hour", minute: 20 });
  });

  it("refuses a time it cannot read rather than picking one", () => {
    // A loop meant for seven that quietly runs at midnight is worse than one
    // that says it cannot read its own settings.
    expect(() => scheduleFrom({ every: "day", at: "half past nine" })).toThrow(/not a time/);
    expect(() => scheduleFrom({ every: "day", at: "25:00" })).toThrow(/no such time/);
    expect(() => scheduleFrom({ every: "fortnight", at: "09:00" })).toThrow(/does not know how/);
  });

  it("fills in what was never set, for a loop saved before it was asked", () => {
    expect(scheduleFrom({})).toEqual({ every: "day", hour: 9, minute: 0 });
  });
});

describe("when it last came round", () => {
  it("is today when today's time has passed", () => {
    expect(lastDue(daily, at("2026-03-10 14:00"))).toEqual(at("2026-03-10 09:00"));
  });

  it("is yesterday when it has not", () => {
    expect(lastDue(daily, at("2026-03-10 08:59"))).toEqual(at("2026-03-09 09:00"));
  });

  it("counts the moment itself as come round", () => {
    expect(lastDue(daily, at("2026-03-10 09:00"))).toEqual(at("2026-03-10 09:00"));
  });

  it("skips the weekend when it is only meant for weekdays", () => {
    const weekday: Schedule = { every: "weekday", hour: 9, minute: 0 };
    // 2026-03-14 is a Saturday, 15th a Sunday, 16th a Monday.
    expect(at("2026-03-14 12:00").getDay()).toBe(6);
    expect(lastDue(weekday, at("2026-03-15 12:00"))).toEqual(at("2026-03-13 09:00"));
    expect(lastDue(weekday, at("2026-03-16 12:00"))).toEqual(at("2026-03-16 09:00"));
  });

  it("finds the right day of the week", () => {
    // Tuesday.
    const weekly: Schedule = { every: "week", weekday: 2, hour: 18, minute: 0 };
    expect(at("2026-03-10 12:00").getDay()).toBe(2);
    // Tuesday before six is still last Tuesday.
    expect(lastDue(weekly, at("2026-03-10 12:00"))).toEqual(at("2026-03-03 18:00"));
    expect(lastDue(weekly, at("2026-03-10 18:30"))).toEqual(at("2026-03-10 18:00"));
    expect(lastDue(weekly, at("2026-03-16 12:00"))).toEqual(at("2026-03-10 18:00"));
  });

  it("walks back over the turn of a month", () => {
    expect(lastDue(daily, at("2026-04-01 08:00"))).toEqual(at("2026-03-31 09:00"));
  });

  it("keeps to the minute past every hour", () => {
    const hourly: Schedule = { every: "hour", minute: 20 };
    expect(lastDue(hourly, at("2026-03-10 14:25"))).toEqual(at("2026-03-10 14:20"));
    expect(lastDue(hourly, at("2026-03-10 14:05"))).toEqual(at("2026-03-10 13:20"));
    // Back over midnight.
    expect(lastDue(hourly, at("2026-03-10 00:05"))).toEqual(at("2026-03-09 23:20"));
  });
});

describe("what is owed", () => {
  it("is nothing when the last one has already been run", () => {
    const last = at("2026-03-10 09:00");
    expect(dueSince(daily, last, at("2026-03-10 14:00"))).toBeNull();
  });

  it("is the one just passed", () => {
    const yesterday = at("2026-03-09 09:00");
    expect(dueSince(daily, yesterday, at("2026-03-10 09:01"))).toEqual(at("2026-03-10 09:00"));
  });

  it("is one run and not seven, after a week with the lid shut", () => {
    // The point of catching up at all is the summary you are missing now, and
    // six older ones would each cost an agent to tell you about last Tuesday.
    const aWeekAgo = at("2026-03-03 09:00");
    expect(dueSince(daily, aWeekAgo, at("2026-03-10 11:00"))).toEqual(at("2026-03-10 09:00"));
  });

  it("does not fire twice for the same time", () => {
    const fired = dueSince(daily, at("2026-03-09 09:00"), at("2026-03-10 09:30"))!;
    expect(dueSince(daily, fired, at("2026-03-10 09:31"))).toBeNull();
    expect(dueSince(daily, fired, at("2026-03-10 23:59"))).toBeNull();
    expect(dueSince(daily, fired, at("2026-03-11 09:00"))).toEqual(at("2026-03-11 09:00"));
  });
});

/**
 * These only mean anything where a day is sometimes not twenty-four hours, so
 * they are skipped elsewhere rather than asserted into passing. On the machines
 * this runs on, that is most of the world.
 */
describe("the two days a year that are not twenty-four hours", () => {
  // 2026-03-08 is when the United States moves its clocks forward.
  const springs = at("2026-03-08 12:00").getTimezoneOffset() !== at("2026-03-07 12:00").getTimezoneOffset();

  it.runIf(springs)("means nine o'clock yesterday, on the day the hour went missing", () => {
    // The case that catches arithmetic on milliseconds: eight in the morning
    // on the day of the change, so the answer is yesterday and the step back
    // crosses the boundary. A day of milliseconds earlier than nine on the 8th
    // is eight on the 7th.
    expect(lastDue(daily, at("2026-03-08 08:00"))).toEqual(at("2026-03-07 09:00"));
    expect(lastDue(daily, at("2026-03-08 08:00")).getHours()).toBe(9);
  });

  it.runIf(springs)("still means nine o'clock the morning after", () => {
    const before = at("2026-03-07 09:00");
    const due = dueSince(daily, before, at("2026-03-08 10:00"));

    expect(due).toEqual(at("2026-03-08 09:00"));
    // The wall clock, not twenty-four hours later: adding a day of
    // milliseconds would land at eight or at ten.
    expect(due!.getHours()).toBe(9);
  });

  it.runIf(springs)("is still a day apart to a person, not 23 hours", () => {
    const first = lastDue(daily, at("2026-03-07 12:00"));
    const second = lastDue(daily, at("2026-03-08 12:00"));
    expect(second.getHours()).toBe(first.getHours());
    // And the gap really is the short one, which is the thing that would break
    // an implementation counting milliseconds.
    expect(second.getTime() - first.getTime()).toBe(23 * 60 * 60_000);
  });
});
