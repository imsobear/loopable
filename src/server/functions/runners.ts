import { createServerFn } from "@tanstack/react-start";
import { loopableOrigin } from "#/lib/lan.ts";
import { forgetRunner, getJoinToken, listRunners, rotateJoinToken } from "../runners.ts";

export const getRunnersPage = createServerFn({ method: "GET" }).handler(async () => ({
  runners: await listRunners(),
  joinToken: await getJoinToken(),
  origin: loopableOrigin(),
}));

export const rotateRunnerJoinToken = createServerFn({ method: "POST" }).handler(async () =>
  await rotateJoinToken(),
);

export const removeRunner = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await forgetRunner(data.id);
    return await listRunners();
  });
