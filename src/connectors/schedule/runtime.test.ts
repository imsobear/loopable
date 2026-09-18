import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleRuntime } from "./runtime.ts";

const daily = { every: "day", at: "09:00" };

/** Local wall time, which is what a schedule is written in. */
function at(text: string): Date {
  const [date, time] = text.split(" ");
  const [y, m, d] = date!.split("-").map(Number);
  const [hh, mm] = time!.split(":").map(Number);
  return new Date(y!, m! - 1, d!, hh!, mm!, 0, 0);
}

function clockAt(text: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(at(text));
}

function look(settings: Record<string, unknown>, cursor: string | null) {
  return scheduleRuntime.poll!({ workflowId: "schedule.recurring", settings, credential: null, cursor });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("looking at the clock", () => {
  it("says nothing on a first look, and remembers when that was", async () => {
    // Otherwise turning a loop on at four in the afternoon would immediately
    // run this morning's, which is not what anyone means by "every day at
    // nine".
    clockAt("2026-03-10 16:00");
    const answer = await look(daily, null);

    expect(answer.signals).toEqual([]);
    expect(answer.cursor).toBe(at("2026-03-10 16:00").toISOString());
  });

  it("says nothing while the time has not come round", async () => {
    clockAt("2026-03-10 16:00");
    const answer = await look(daily, at("2026-03-10 09:00").toISOString());

    expect(answer.signals).toEqual([]);
    // Left where it was rather than moved up to now, or a loop turned on
    // before nine would never see nine.
    expect(answer.cursor).toBe(at("2026-03-10 09:00").toISOString());
  });

  it("hands over one occurrence when it does", async () => {
    clockAt("2026-03-10 09:00");
    const answer = await look(daily, at("2026-03-09 09:00").toISOString());

    expect(answer.signals).toHaveLength(1);
    const [signal] = answer.signals;
    expect(signal!.kind).toBe("occurrence");
    expect(signal!.key).toBe(at("2026-03-10 09:00").toISOString());
    // Kept because it cannot be worked out again: a run owed from nine that
    // starts at eleven is still about nine.
    expect(signal!.payload).toEqual({ due: at("2026-03-10 09:00").toISOString() });
    // A time has no address, and the pages that show a source handle that.
    expect(signal!.url).toBe("");
    expect(answer.cursor).toBe(signal!.key);
  });

  it("will not hand the same occurrence over twice", async () => {
    clockAt("2026-03-10 09:00");
    const first = await look(daily, at("2026-03-09 09:00").toISOString());
    const moved = first.cursor as string;

    // Every look for the rest of the day, at the pace the dispatcher keeps.
    clockAt("2026-03-10 09:02");
    expect((await look(daily, moved)).signals).toEqual([]);
    clockAt("2026-03-10 23:59");
    expect((await look(daily, moved)).signals).toEqual([]);

    clockAt("2026-03-11 09:00");
    expect((await look(daily, moved)).signals).toHaveLength(1);
  });

  it("owes one run and not seven after a week with the lid shut", async () => {
    clockAt("2026-03-10 11:00");
    const answer = await look(daily, at("2026-03-03 09:00").toISOString());

    expect(answer.signals).toHaveLength(1);
    expect(answer.signals[0]!.key).toBe(at("2026-03-10 09:00").toISOString());
  });

  it("starts over rather than throwing when the cursor is nonsense", async () => {
    clockAt("2026-03-10 16:00");
    const answer = await look(daily, "not a date");

    expect(answer.signals).toEqual([]);
    expect(answer.cursor).toBe(at("2026-03-10 16:00").toISOString());
  });

  it("carries a settings error up rather than running at some other time", async () => {
    clockAt("2026-03-10 16:00");
    await expect(look({ every: "day", at: "9am" }, null)).rejects.toThrow(/not a time/);
  });
});

describe("a run somebody asked for", () => {
  it("is about the moment they asked", async () => {
    clockAt("2026-03-10 16:23");
    const item = scheduleRuntime.itemForNow!();

    expect(item.kind).toBe("occurrence");
    // Asserted by what it names rather than by how it is written, which is
    // whatever this machine's locale says and not this module's business.
    expect(item.ref).toBe(at("2026-03-10 16:23").toLocaleString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }));

    clockAt("2026-03-11 16:23");
    expect(scheduleRuntime.itemForNow!().ref).not.toBe(item.ref);
  });

  it("has nothing to read, because nothing arrived", async () => {
    clockAt("2026-03-10 16:23");
    const resolved = await scheduleRuntime.resolveWorkItem!({
      url: "",
      payload: null,
      credential: null,
    });

    expect(resolved.context).toEqual([]);
  });

  it("is about the occurrence when the clock started it, not about now", async () => {
    // The catching-up case: owed from nine, run at eleven. Told wrong, an
    // agent writing a daily summary would summarise the wrong day.
    clockAt("2026-03-10 11:00");
    const resolved = await scheduleRuntime.resolveWorkItem!({
      url: "",
      payload: { due: at("2026-03-10 09:00").toISOString() },
      credential: null,
    });

    expect(resolved.ref).toContain("09:00");
  });
});

describe("keeping it in the log", () => {
  it("writes nowhere and offers no address, because the task is the record", async () => {
    const outcome = await scheduleRuntime.applyAction!({
      actionId: "schedule.record",
      target: {},
      source: { connectorId: "schedule", kind: "occurrence", ref: "x", title: "x", url: "" },
      body: "anything",
      credential: null,
    });

    expect(outcome.url).toBe("");
  });

  it("refuses an action it does not have", async () => {
    await expect(
      scheduleRuntime.applyAction!({
        actionId: "schedule.send_email",
        target: {},
        source: { connectorId: "schedule", kind: "occurrence", ref: "x", title: "x", url: "" },
        body: "anything",
        credential: null,
      }),
    ).rejects.toThrow(/cannot/);
  });
});
