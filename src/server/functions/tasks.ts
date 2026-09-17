import { createServerFn } from "@tanstack/react-start";
import { runningEnginePid } from "../../engine/instance.ts";
import { enqueueTask, getTask, listTasks, readTaskLog, requestCancel } from "../tasks.ts";
import { engineSettings, setEnginePaused } from "../settings.ts";
import { onlineRunnerCount } from "../runners.ts";

export const getInbox = createServerFn({ method: "GET" }).handler(() => listTasks());

export const getLoopTasks = createServerFn({ method: "GET" })
  .inputValidator((data: { loopId: string }) => data)
  .handler(({ data }) => listTasks({ loopId: data.loopId }));

export const getTaskById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => getTask(data.id));

export const getTaskLog = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => readTaskLog(data.id));

export const runLoopNow = createServerFn({ method: "POST" })
  .inputValidator((data: { loopId: string; url: string; dryRun: boolean }) => data)
  .handler(({ data }) => enqueueTask(data));

export const stopTask = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => requestCancel(data.id));

/** Whether the engine is up, and how hard it is allowed to pull. */
export const getEngineState = createServerFn({ method: "GET" }).handler(() => ({
  enginePid: runningEnginePid(),
  onlineRunners: onlineRunnerCount(),
  ...engineSettings(),
}));

export const pauseEngine = createServerFn({ method: "POST" })
  .inputValidator((data: { paused: boolean }) => data)
  .handler(({ data }) => setEnginePaused(data.paused));
