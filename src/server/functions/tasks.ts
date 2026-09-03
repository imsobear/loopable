import { createServerFn } from "@tanstack/react-start";
import { runningDaemonPid } from "../../daemon/instance.ts";
import { enqueueTask, getTask, listTasks, requestCancel } from "../tasks.ts";
import { runnerSettings, setRunnerPaused } from "../settings.ts";

export const getInbox = createServerFn({ method: "GET" }).handler(() => listTasks());

export const getRuleTasks = createServerFn({ method: "GET" })
  .inputValidator((data: { ruleId: string }) => data)
  .handler(({ data }) => listTasks({ ruleId: data.ruleId }));

export const getTaskById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => getTask(data.id));

export const runRuleNow = createServerFn({ method: "POST" })
  .inputValidator((data: { ruleId: string; url: string; dryRun: boolean }) => data)
  .handler(({ data }) => enqueueTask(data));

export const stopTask = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => requestCancel(data.id));

/** Whether the engine is up, and how hard it is allowed to pull. */
export const getRunnerState = createServerFn({ method: "GET" }).handler(() => ({
  daemonPid: runningDaemonPid(),
  ...runnerSettings(),
}));

export const pauseRunner = createServerFn({ method: "POST" })
  .inputValidator((data: { paused: boolean }) => data)
  .handler(({ data }) => setRunnerPaused(data.paused));
