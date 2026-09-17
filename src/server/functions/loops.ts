import { createServerFn } from "@tanstack/react-start";
import {
  createLoop,
  deleteLoop,
  getLoop,
  listLoops,
  moveLoop,
  loopReadiness,
  setLoopEnabled,
  updateLoop,
} from "../loops.ts";
import type { LoopEdit } from "#/lib/domain.ts";
import { loopPollState, runBacklog } from "../signals.ts";

/**
 * Saving is both making and changing, told apart by whether there is an id.
 * A loop chosen and not yet saved has none, and nothing on the server knew
 * about it until now.
 */
const edit = (data: LoopEdit) => data;

export const getLoopsPage = createServerFn({ method: "GET" }).handler(async () => ({
  loops: listLoops(),
  readiness: await loopReadiness(),
}));

export const getLoopReadiness = createServerFn({ method: "GET" }).handler(() => loopReadiness());

export const getLoopById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => getLoop(data.id));

export const saveLoop = createServerFn({ method: "POST" })
  .inputValidator(edit)
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

export const getLoopPollState = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => loopPollState(data.id));

export const runLoopBacklog = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => ({ queued: runBacklog(data.id) }));
