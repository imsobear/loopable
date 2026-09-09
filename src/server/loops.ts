import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { connectorManifest, connectorWorkflow } from "#/connectors/manifests.ts";
import type { SettingField } from "#/connectors/types.ts";
import type { ConnectionSettings, LoopReadiness, LoopView } from "#/lib/domain.ts";
import { listAgents } from "./agents.ts";
import { db } from "./db/client.ts";
import { connections, loops, type Loop } from "./db/schema.ts";

export type LoopDraft = {
  name: string;
  connectorId: string;
  workflowId: string;
  guidance: string | null;
  agentId: string | null;
  settings: ConnectionSettings;
  enabled: boolean;
};

const NAME_LIMIT = 80;
const GUIDANCE_LIMIT = 4000;

function toView(row: Loop): LoopView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    connectorId: row.connectorId,
    workflowId: row.workflowId,
    settings: row.settings,
    guidance: row.guidance,
    agentId: row.agentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Only the fields the chosen workflow declares survive, and each is coerced to
 * the kind it was declared as. A stored setting the connector no longer offers
 * would otherwise sit there narrowing things invisibly.
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

function validate(draft: LoopDraft): LoopDraft {
  const manifest = connectorManifest(draft.connectorId);
  if (!manifest) throw new Error(`Unknown connector: ${draft.connectorId}`);

  const workflow = connectorWorkflow(draft.connectorId, draft.workflowId);
  if (!workflow) throw new Error(`${manifest.name} does not offer ${draft.workflowId}.`);

  if (draft.agentId && !agentManifest(draft.agentId)) {
    throw new Error(`Unknown agent: ${draft.agentId}`);
  }

  const name = draft.name.trim();
  if (!name) throw new Error("Give the loop a name.");
  if (name.length > NAME_LIMIT) throw new Error(`Keep the name under ${NAME_LIMIT} characters.`);

  // The workflow already knows what to ask for, so guidance is genuinely
  // optional and an empty box is stored as nothing rather than as "".
  const guidance = draft.guidance?.trim() || null;
  if (guidance && guidance.length > GUIDANCE_LIMIT) {
    throw new Error(`Keep the guidance under ${GUIDANCE_LIMIT} characters.`);
  }

  return {
    ...draft,
    name,
    guidance,
    settings: cleanConditions(workflow.settings, draft.settings),
  };
}

export function listLoops(): LoopView[] {
  return db().select().from(loops).orderBy(asc(loops.priority)).all().map(toView);
}

export function getLoop(id: string): LoopView | null {
  const row = db().select().from(loops).where(eq(loops.id, id)).get();
  return row ? toView(row) : null;
}

export function createLoop(draft: LoopDraft): LoopView {
  const checked = validate(draft);
  const last = db()
    .select({ value: sql<number | null>`max(${loops.priority})` })
    .from(loops)
    .get();
  const id = randomUUID();
  db()
    .insert(loops)
    .values({
      id,
      name: checked.name,
      enabled: checked.enabled,
      priority: (last?.value ?? 0) + 1,
      connectorId: checked.connectorId,
      workflowId: checked.workflowId,
      settings: checked.settings,
      guidance: checked.guidance,
      agentId: checked.agentId,
    })
    .run();
  return getLoop(id)!;
}

export function updateLoop(id: string, draft: LoopDraft): LoopView {
  if (!getLoop(id)) throw new Error("Loop not found");
  const checked = validate(draft);
  db()
    .update(loops)
    .set({
      name: checked.name,
      enabled: checked.enabled,
      connectorId: checked.connectorId,
      workflowId: checked.workflowId,
      settings: checked.settings,
      guidance: checked.guidance,
      agentId: checked.agentId,
      updatedAt: new Date(),
    })
    .where(eq(loops.id, id))
    .run();
  return getLoop(id)!;
}

export function setLoopEnabled(id: string, enabled: boolean): LoopView {
  if (!getLoop(id)) throw new Error("Loop not found");
  db().update(loops).set({ enabled, updatedAt: new Date() }).where(eq(loops.id, id)).run();
  return getLoop(id)!;
}

export function deleteLoop(id: string): void {
  db().delete(loops).where(eq(loops.id, id)).run();
}

/**
 * The first matching loop wins, so a person has to be able to say which comes
 * first. Swapping with the neighbour keeps that to one obvious gesture.
 */
export function moveLoop(id: string, direction: "up" | "down"): LoopView[] {
  const ordered = db().select().from(loops).orderBy(asc(loops.priority)).all();
  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) throw new Error("Loop not found");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered.map(toView);

  const moving = ordered[index]!;
  const neighbour = ordered[target]!;
  db().transaction((tx) => {
    tx.update(loops).set({ priority: neighbour.priority }).where(eq(loops.id, moving.id)).run();
    tx.update(loops).set({ priority: moving.priority }).where(eq(loops.id, neighbour.id)).run();
  });
  return listLoops();
}

/**
 * Turn on one of a connector's workflows. Everything a workflow needs it
 * already declares a default for, so this is the whole of "adding a loop" in
 * the common case, and the form is only for changing one afterwards.
 */
export function createLoopFromWorkflow(connectorId: string, workflowId: string): LoopView {
  const workflow = connectorWorkflow(connectorId, workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  return createLoop({
    name: workflow.name,
    connectorId,
    workflowId,
    guidance: null,
    agentId: null,
    settings: {},
    enabled: true,
  });
}

/**
 * A loop can be written before anything is connected or installed, so the page
 * says what is still missing rather than refusing to save.
 */
export async function loopReadiness(): Promise<LoopReadiness> {
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