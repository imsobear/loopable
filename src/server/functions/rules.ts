import { createServerFn } from "@tanstack/react-start";
import {
  createRule,
  createRuleFromWorkflow,
  deleteRule,
  getRule,
  listRules,
  moveRule,
  ruleReadiness,
  setRuleEnabled,
  updateRule,
  type RuleDraft,
} from "../rules.ts";
import { rulePollState, runBacklog } from "../signals.ts";

const draft = (data: RuleDraft & { id?: string }) => data;

export const getRulesPage = createServerFn({ method: "GET" }).handler(async () => ({
  rules: listRules(),
  readiness: await ruleReadiness(),
}));

export const getRuleById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => getRule(data.id));

export const saveRule = createServerFn({ method: "POST" })
  .inputValidator(draft)
  .handler(({ data }) => {
    const { id, ...values } = data;
    return id ? updateRule(id, values) : createRule(values);
  });

export const toggleRule = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; enabled: boolean }) => data)
  .handler(({ data }) => setRuleEnabled(data.id, data.enabled));

export const removeRule = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => {
    deleteRule(data.id);
    return listRules();
  });

export const reorderRule = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; direction: "up" | "down" }) => data)
  .handler(({ data }) => moveRule(data.id, data.direction));

export const addRuleForWorkflow = createServerFn({ method: "POST" })
  .inputValidator((data: { connectorId: string; workflowId: string }) => data)
  .handler(({ data }) => createRuleFromWorkflow(data.connectorId, data.workflowId));

export const getRulePollState = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => rulePollState(data.id));

export const runRuleBacklog = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => ({ queued: runBacklog(data.id) }));
