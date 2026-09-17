import { createServerFn } from "@tanstack/react-start";
import { loopableOrigin } from "#/lib/callback.ts";
import { forgetRunner, getJoinToken, listRunners, rotateJoinToken } from "../runners.ts";

export const getRunnersPage = createServerFn({ method: "GET" }).handler(async () => ({
  runners: listRunners(),
  joinToken: await getJoinToken(),
  origin: loopableOrigin(),
}));

export const rotateRunnerJoinToken = createServerFn({ method: "POST" }).handler(() =>
  rotateJoinToken(),
);

export const removeRunner = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await forgetRunner(data.id);
    return listRunners();
  });
