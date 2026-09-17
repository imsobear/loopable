import type { SettingField } from "../types.ts";
import { defineManifest } from "../define.ts";
import { WEEKDAY_NAMES } from "./schedule.ts";

/**
 * A clock, as a source of work.
 *
 * It is a connector because everything downstream of a trigger already works:
 * a loop watches something, what it notices is deduplicated, becomes a task,
 * runs an agent and is written somewhere by an action. A time coming round is
 * simply another thing to notice. What makes this one unusual is only that
 * there is no account, which is what `auth: none` says.
 */

const every: SettingField = {
  key: "every",
  kind: "select",
  label: "How often",
  options: [
    { value: "hour", label: "Every hour" },
    { value: "day", label: "Every day" },
    { value: "weekday", label: "Every weekday" },
    { value: "week", label: "Once a week" },
  ],
  default: "day",
};

const at: SettingField = {
  key: "at",
  kind: "text",
  label: "At",
  help: "On a 24-hour clock, in this host's own time zone. Only the minutes are used by an hourly loop.",
  placeholder: "09:00",
};

const weekday: SettingField = {
  key: "weekday",
  kind: "select",
  label: "On",
  help: "Only used by a loop that runs once a week.",
  options: WEEKDAY_NAMES.map((name, index) => ({ value: String(index), label: name })),
  default: "1",
};

const folder: SettingField = {
  key: "folder",
  kind: "text",
  label: "Folder to work in",
  help: "An absolute path. Nothing arrives to be looked at on a schedule, so this is the whole of what the agent is given.",
  placeholder: "/Users/you/code/web",
};

/**
 * Deliberately a frame rather than a job. Every other workflow ships a prompt
 * because "review a pull request" is a problem worth solving once and getting
 * right; what to do at nine in the morning is not that kind of problem, and
 * the only person who knows it is the one setting the loop up. So this ships
 * something that works on the day it is turned on, and says plainly that it is
 * meant to be replaced.
 */
const RECURRING_PROMPT = [
  "Nothing has arrived: this is running because the time came round.",
  "",
  "Look over the folder you are in and report anything that someone working",
  "here would want to know today. Uncommitted work left sitting, a branch",
  "well behind its base, failing checks, dependencies with published security",
  "advisories: whatever is actually true of this checkout right now.",
  "",
  "Be brief and concrete. Name files and branches. Say nothing about what you",
  "looked at and found fine.",
].join("\n");

export const scheduleManifest = defineManifest({
  id: "schedule",
  name: "Schedule",
  tagline: "Run a loop when the time comes round, rather than when something arrives.",
  icon: "Clock",
  accent: "bg-slate-700 text-white",
  auth: { kind: "none" },
  allowsMultipleAccounts: false,
  byHand: { kind: "now" },
  settings: [],
  workflows: [
    {
      id: "schedule.recurring",
      name: "Do something on a schedule",
      summary: "Runs an agent in a folder you name, and keeps what it says.",
      trigger: "the time you set comes round",
      // No query to show. A clock is not something one can be written for,
      // and an invented one shown as if it were real is worse than nothing.
      writes: "a note in the log",
      runsIn: "folder",
      settings: [every, at, weekday, folder],
      prompt: RECURRING_PROMPT,
      guidancePlaceholder:
        "Anything that holds every time this runs. For example: this repository releases on Thursdays, so say if anything is unmerged by Wednesday evening.",
      answer: "text",
      actionId: "schedule.record",
    },
  ],
  actions: [
    {
      id: "schedule.record",
      name: "Keep it in the log",
      summary:
        "Leaves the answer here and sends it nowhere. Every run is recorded anyway, so this is what to use until it is worth pushing somewhere.",
      target: [],
      accepts: ["text", "review"],
    },
  ],
});
