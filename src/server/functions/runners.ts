import { createServerFn } from "@tanstack/react-start";
import { loopableOrigin } from "#/lib/lan.ts";
import { isHosted } from "#/lib/hosted.ts";
import {
  forgetRunner,
  getJoinToken,
  latestRunnerVersion,
  listRunners,
  requestRunnerUpdate,
  rotateJoinToken,
  setRunnerEnabled,
} from "../runners.ts";

export const getRunnersPage = createServerFn({ method: "GET" }).handler(async () => ({
  runners: await listRunners(await latestRunnerVersion()),
  joinToken: await getJoinToken(),
  origin: loopableOrigin(),
  hosted: isHosted(),
}));

export const rotateRunnerJoinToken = createServerFn({ method: "POST" }).handler(async () =>
  await rotateJoinToken(),
);

export const removeRunner = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await forgetRunner(data.id);
    return { ok: true };
  });

export const toggleRunner = createServerFn({ method: "POST" })
  .validator((data: { id: string; enabled: boolean }) => data)
  .handler(async ({ data }) => {
    await setRunnerEnabled(data.id, data.enabled);
    return { ok: true };
  });

export const updateRunner = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requestRunnerUpdate(data.id);
    return { ok: true };
  });
