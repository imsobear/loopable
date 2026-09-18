import { createServerFn } from "@tanstack/react-start";
import { dispatcherIsAlive } from "../../dispatcher/instance.ts";
import { enqueuePrompt, enqueueTask, getTask, listRunnableAgents, listTasks, readTaskLog, requestCancel } from "../tasks.ts";
import { dispatcherSettings, setDispatcherPaused } from "../settings.ts";
import { onlineRunnerCount } from "../runners.ts";

export const getInbox = createServerFn({ method: "GET" }).handler(async () => ({
  tasks: await listTasks(),
  agents: await listRunnableAgents(),
}));

export const getLoopTasks = createServerFn({ method: "GET" })
  .inputValidator((data: { loopId: string }) => data)
  .handler(async ({ data }) => await listTasks({ loopId: data.loopId }));

export const getTaskById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => await getTask(data.id));

export const getTaskLog = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => await readTaskLog(data.id));

export const runPrompt = createServerFn({ method: "POST" })
  .inputValidator((data: { prompt: string; agentId: string }) => data)
  .handler(async ({ data }) => await enqueuePrompt(data));

export const runLoopNow = createServerFn({ method: "POST" })
  .inputValidator((data: { loopId: string; url: string; dryRun: boolean }) => data)
  .handler(async ({ data }) => await enqueueTask(data));

export const stopTask = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => await requestCancel(data.id));

/** Whether the dispatcher is up, and how hard it is allowed to pull. */
export const getDispatcherState = createServerFn({ method: "GET" }).handler(async () => ({
  alive: await dispatcherIsAlive(),
  onlineRunners: await onlineRunnerCount(),
  ...(await dispatcherSettings()),
}));

export const pauseDispatcher = createServerFn({ method: "POST" })
  .inputValidator((data: { paused: boolean }) => data)
  .handler(async ({ data }) => await setDispatcherPaused(data.paused));
