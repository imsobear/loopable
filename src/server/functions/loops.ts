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
  loops: await listLoops(),
  readiness: await loopReadiness(),
}));

export const getLoopReadiness = createServerFn({ method: "GET" }).handler(async () => await loopReadiness());

export const getLoopById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => await getLoop(data.id));

export const saveLoop = createServerFn({ method: "POST" })
  .inputValidator(edit)
  .handler(async ({ data }) => {
    const { id, ...values } = data;
    return id ? await updateLoop(id, values) : await createLoop(values);
  });

export const toggleLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; enabled: boolean }) => data)
  .handler(async ({ data }) => await setLoopEnabled(data.id, data.enabled));

export const removeLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await deleteLoop(data.id);
    return await listLoops();
  });

export const reorderLoop = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; direction: "up" | "down" }) => data)
  .handler(async ({ data }) => await moveLoop(data.id, data.direction));

export const getLoopPollState = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => await loopPollState(data.id));

export const runLoopBacklog = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => ({ queued: await runBacklog(data.id) }));
