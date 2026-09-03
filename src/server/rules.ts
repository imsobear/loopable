import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { connectorManifest } from "#/connectors/manifests.ts";
import type { SettingField } from "#/connectors/types.ts";
import type { ConnectionSettings, JsonValue, RuleReadiness, RuleView } from "#/lib/domain.ts";
import { listAgents } from "./agents.ts";
import { db } from "./db/client.ts";
import { connections, rules, type Rule } from "./db/schema.ts";

export type RuleDraft = {
  name: string;
  connectorId: string;
  eventId: string;
  actionId: string;
  instruction: string;
  agentId: string | null;
  conditions: ConnectionSettings;
  enabled: boolean;
};

const NAME_LIMIT = 80;
const INSTRUCTION_LIMIT = 4000;

function toView(row: Rule): RuleView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    connectorId: row.connectorId,
    eventId: row.eventId,
    conditions: row.conditions,
    instruction: row.instruction,
    agentId: row.agentId,
    actionId: row.actionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Only the fields the chosen event declares survive, and each is coerced to the
 * kind it was declared as. A stored condition the connector no longer offers
 * would otherwise sit there filtering invisibly.
 */
function cleanConditions(fields: SettingField[], input: ConnectionSettings): ConnectionSettings {
  const cleaned: ConnectionSettings = {};
  for (const field of fields) {
    const value = input[field.key];
    switch (field.kind) {
      case "boolean":
        cleaned[field.key] = typeof value === "boolean" ? value : field.default;
        break;
      case "string_list":
        cleaned[field.key] = Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
          : [];
        break;
      case "select":
        cleaned[field.key] =
          typeof value === "string" && field.options.some((option) => option.value === value)
            ? value
            : field.default;
        break;
      default:
        cleaned[field.key] = typeof value === "string" ? value.trim() : "";
    }
  }
  return cleaned;
}

function validate(draft: RuleDraft): RuleDraft {
  const manifest = connectorManifest(draft.connectorId);
  if (!manifest) throw new Error(`Unknown connector: ${draft.connectorId}`);

  const event = manifest.events.find((entry) => entry.id === draft.eventId);
  if (!event) throw new Error(`${manifest.name} does not report ${draft.eventId}.`);

  const action = manifest.actions.find((entry) => entry.id === draft.actionId);
  if (!action) throw new Error(`${manifest.name} cannot ${draft.actionId}.`);

  if (draft.agentId && !agentManifest(draft.agentId)) {
    throw new Error(`Unknown agent: ${draft.agentId}`);
  }

  const name = draft.name.trim();
  if (!name) throw new Error("Give the rule a name.");
  if (name.length > NAME_LIMIT) throw new Error(`Keep the name under ${NAME_LIMIT} characters.`);

  const instruction = draft.instruction.trim();
  if (!instruction) throw new Error("Tell the agent what to do.");
  if (instruction.length > INSTRUCTION_LIMIT) {
    throw new Error(`Keep the instruction under ${INSTRUCTION_LIMIT} characters.`);
  }

  return {
    ...draft,
    name,
    instruction,
    conditions: cleanConditions(event.conditions ?? [], draft.conditions),
  };
}

export function listRules(): RuleView[] {
  return db().select().from(rules).orderBy(asc(rules.priority)).all().map(toView);
}

export function getRule(id: string): RuleView | null {
  const row = db().select().from(rules).where(eq(rules.id, id)).get();
  return row ? toView(row) : null;
}

export function createRule(draft: RuleDraft): RuleView {
  const checked = validate(draft);
  const last = db()
    .select({ value: sql<number | null>`max(${rules.priority})` })
    .from(rules)
    .get();
  const id = randomUUID();
  db()
    .insert(rules)
    .values({
      id,
      name: checked.name,
      enabled: checked.enabled,
      priority: (last?.value ?? 0) + 1,
      connectorId: checked.connectorId,
      eventId: checked.eventId,
      conditions: checked.conditions,
      instruction: checked.instruction,
      agentId: checked.agentId,
      actionId: checked.actionId,
    })
    .run();
  return getRule(id)!;
}

export function updateRule(id: string, draft: RuleDraft): RuleView {
  if (!getRule(id)) throw new Error("Rule not found");
  const checked = validate(draft);
  db()
    .update(rules)
    .set({
      name: checked.name,
      enabled: checked.enabled,
      connectorId: checked.connectorId,
      eventId: checked.eventId,
      conditions: checked.conditions,
      instruction: checked.instruction,
      agentId: checked.agentId,
      actionId: checked.actionId,
      updatedAt: new Date(),
    })
    .where(eq(rules.id, id))
    .run();
  return getRule(id)!;
}

export function setRuleEnabled(id: string, enabled: boolean): RuleView {
  if (!getRule(id)) throw new Error("Rule not found");
  db().update(rules).set({ enabled, updatedAt: new Date() }).where(eq(rules.id, id)).run();
  return getRule(id)!;
}

export function deleteRule(id: string): void {
  db().delete(rules).where(eq(rules.id, id)).run();
}

/**
 * The first matching rule wins, so a person has to be able to say which comes
 * first. Swapping with the neighbour keeps that to one obvious gesture.
 */
export function moveRule(id: string, direction: "up" | "down"): RuleView[] {
  const ordered = db().select().from(rules).orderBy(asc(rules.priority)).all();
  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) throw new Error("Rule not found");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered.map(toView);

  const moving = ordered[index]!;
  const neighbour = ordered[target]!;
  db().transaction((tx) => {
    tx.update(rules).set({ priority: neighbour.priority }).where(eq(rules.id, moving.id)).run();
    tx.update(rules).set({ priority: moving.priority }).where(eq(rules.id, neighbour.id)).run();
  });
  return listRules();
}

/** Add a rule the connector suggests, exactly as if it had been typed by hand. */
export function createRuleFromTemplate(connectorId: string, templateId: string): RuleView {
  const manifest = connectorManifest(connectorId);
  if (!manifest) throw new Error(`Unknown connector: ${connectorId}`);
  const template = manifest.ruleTemplates.find((entry) => entry.id === templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  return createRule({
    name: template.name,
    connectorId,
    eventId: template.eventId,
    actionId: template.actionId,
    instruction: template.instruction,
    agentId: null,
    conditions: template.conditions as Record<string, JsonValue>,
    enabled: true,
  });
}

/**
 * A rule can be written before anything is connected or installed, so the page
 * says what is still missing rather than refusing to save.
 */
export async function ruleReadiness(): Promise<RuleReadiness> {
  const agents = await listAgents();
  const connected = db()
    .selectDistinct({ connectorId: connections.connectorId })
    .from(connections)
    .all();
  return {
    connectedConnectorIds: connected.map((row) => row.connectorId),
    defaultAgentId: agents.find((agent) => agent.isDefault)?.agentId ?? null,
    installedAgentIds: agents.filter((agent) => agent.installed).map((agent) => agent.agentId),
  };
}