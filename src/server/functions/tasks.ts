import { createServerFn } from "@tanstack/react-start";
import { getTask, listTasks, runRuleAgainstUrl } from "../tasks.ts";

export const getInbox = createServerFn({ method: "GET" }).handler(() => listTasks());

export const getRuleTasks = createServerFn({ method: "GET" })
  .inputValidator((data: { ruleId: string }) => data)
  .handler(({ data }) => listTasks({ ruleId: data.ruleId }));

export const getTaskById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => getTask(data.id));

export const runRuleNow = createServerFn({ method: "POST" })
  .inputValidator((data: { ruleId: string; url: string; dryRun: boolean }) => data)
  .handler(({ data }) => runRuleAgainstUrl(data));
