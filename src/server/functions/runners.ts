import { createServerFn } from "@tanstack/react-start";
import { loopableOrigin } from "#/lib/lan.ts";
import { isHosted } from "#/lib/hosted.ts";
import { forgetRunner, getJoinToken, listRunners, rotateJoinToken } from "../runners.ts";
import { approveRunnerLogin, describeRunnerLogin } from "../runner-logins.ts";

export const getRunnersPage = createServerFn({ method: "GET" }).handler(async () => ({
  runners: await listRunners(),
  joinToken: await getJoinToken(),
  origin: loopableOrigin(),
  hosted: isHosted(),
}));

export const getRunnerLogin = createServerFn({ method: "GET" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => ({ state: await describeRunnerLogin(data.code) }));

export const approveRunner = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    await approveRunnerLogin(data.code);
    return { ok: true };
  });

export const rotateRunnerJoinToken = createServerFn({ method: "POST" }).handler(async () =>
  await rotateJoinToken(),
);

export const removeRunner = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await forgetRunner(data.id);
    return await listRunners();
  });
