import { createServerFn } from "@tanstack/react-start";
import {
  createLoop,
  createLoopFromWorkflow,
  deleteLoop,
  getLoop,
  listLoops,
  moveLoop,
  loopReadiness,
  setLoopEnabled,
  updateLoop,
  type LoopDraft,
} from "../loops.ts";
import { loopPollState, runBacklog } from "../signals.ts";

const draft = (data: LoopDraft & { id?: string }) => data;

export const getLoopsPage = createServerFn({ method: "GET" }).handler(async () => ({
  loops: listLoops(),
  readiness: await loopReadiness(),
}));

export const getLoopById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => getLoop(data.id));

export const saveLoop = createServerFn({ method: "POST" })
  .inputValidator(draft)
  .handler(({ data }) => {
    const { id, ...values } = data;
    return id ? updateLoop(id, values) : createLoop(values);
  });

export const toggleLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; enabled: boolean }) => data)
  .handler(({ data }) => setLoopEnabled(data.id, data.enabled));

export const removeLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => {
    deleteLoop(data.id);
    return listLoops();
  });

export const reorderLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; direction: "up" | "down" }) => data)
  .handler(({ data }) => moveLoop(data.id, data.direction));

export const addLoopForWorkflow = createServerFn({ method: "POST" })
  .inputValidator((data: { connectorId: string; workflowId: string }) => data)
  .handler(({ data }) => createLoopFromWorkflow(data.connectorId, data.workflowId));

export const getLoopPollState = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => loopPollState(data.id));

export const runLoopBacklog = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => ({ queued: runBacklog(data.id) }));
