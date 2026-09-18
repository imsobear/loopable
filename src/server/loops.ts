import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { connectorAction, connectorManifest, connectorWorkflow } from "#/connectors/manifests.ts";
import type { SettingField } from "#/connectors/types.ts";
import type { ConnectionSettings, LoopDraft, LoopReadiness, LoopView } from "#/lib/domain.ts";
import { listAgents } from "./agents.ts";
import { availableAgentIds } from "./runners.ts";
import { db } from "./db/client.ts";
import { connections, loops, type Loop } from "./db/schema.ts";

const NAME_LIMIT = 80;
const PROMPT_LIMIT = 8000;
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
    prompt: row.prompt,
    guidance: row.guidance,
    agentId: row.agentId,
    actionConnectorId: row.actionConnectorId,
    actionId: row.actionId,
    actionTarget: row.actionTarget,
    pollEveryMs: row.pollEveryMs,
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

  // Where the answer goes is the loop's to choose, and can be a connector it
  // does not watch, so this is where a choice that cannot work is caught.
  const writer = connectorManifest(draft.actionConnectorId);
  if (!writer) throw new Error(`Unknown connector: ${draft.actionConnectorId}`);
  const action = connectorAction(draft.actionConnectorId, draft.actionId);
  if (!action) throw new Error(`${writer.name} cannot ${draft.actionId}.`);

  if (draft.agentId && !agentManifest(draft.agentId)) {
    throw new Error(`Unknown agent: ${draft.agentId}`);
  }

  const name = draft.name.trim();
  if (!name) throw new Error("Give the loop a name.");
  if (name.length > NAME_LIMIT) throw new Error(`Keep the name under ${NAME_LIMIT} characters.`);

  // Refused rather than quietly filled back in from the workflow: emptying
  // this box is a mistake worth hearing about, since a loop with nothing to
  // ask would run an agent and post whatever came back.
  const prompt = draft.prompt.trim();
  if (!prompt) throw new Error("Say what the agent should do.");
  if (prompt.length > PROMPT_LIMIT) {
    throw new Error(`Keep what you ask under ${PROMPT_LIMIT} characters.`);
  }

  // The prompt already says what to do, so guidance is genuinely optional and
  // an empty box is stored as nothing rather than as "".
  const guidance = draft.guidance?.trim() || null;
  if (guidance && guidance.length > GUIDANCE_LIMIT) {
    throw new Error(`Keep the guidance under ${GUIDANCE_LIMIT} characters.`);
  }

  // A job that works in a checkout cannot be told which one later: it would
  // sit enabled, come round on time and fail at the last step every time.
  // Caught while the person is still looking at the box.
  if (workflow.runsIn === "folder") {
    const folder = draft.settings.folder;
    if (typeof folder !== "string" || folder.trim() === "") {
      throw new Error("Say which folder this should work in.");
    }
  }

  return {
    ...draft,
    name,
    prompt,
    guidance,
    settings: cleanConditions(workflow.settings, draft.settings),
    actionTarget: cleanConditions(action.target, draft.actionTarget),
  };
}

export async function listLoops(): Promise<LoopView[]> {
  return (await db().select().from(loops).orderBy(asc(loops.priority)).all()).map(toView);
}

export async function getLoop(id: string): Promise<LoopView | null> {
  const row = await db().select().from(loops).where(eq(loops.id, id)).get();
  return row ? toView(row) : null;
}

export async function createLoop(draft: LoopDraft): Promise<LoopView> {
  const checked = validate(draft);
  const last = await db()
    .select({ value: sql<number | null>`max(${loops.priority})` })
    .from(loops)
    .get();
  const id = randomUUID();
  await db()
    .insert(loops)
    .values({
      id,
      name: checked.name,
      enabled: checked.enabled,
      priority: (last?.value ?? 0) + 1,
      connectorId: checked.connectorId,
      workflowId: checked.workflowId,
      settings: checked.settings,
      prompt: checked.prompt,
      guidance: checked.guidance,
      agentId: checked.agentId,
      actionConnectorId: checked.actionConnectorId,
      actionId: checked.actionId,
      actionTarget: checked.actionTarget,
      pollEveryMs: checked.pollEveryMs,
    })
    .run();
  return (await getLoop(id))!;
}

export async function updateLoop(id: string, draft: LoopDraft): Promise<LoopView> {
  if (!(await getLoop(id))) throw new Error("Loop not found");
  const checked = validate(draft);
  await db()
    .update(loops)
    .set({
      name: checked.name,
      enabled: checked.enabled,
      connectorId: checked.connectorId,
      workflowId: checked.workflowId,
      settings: checked.settings,
      prompt: checked.prompt,
      guidance: checked.guidance,
      agentId: checked.agentId,
      actionConnectorId: checked.actionConnectorId,
      actionId: checked.actionId,
      actionTarget: checked.actionTarget,
      pollEveryMs: checked.pollEveryMs,
      updatedAt: new Date(),
    })
    .where(eq(loops.id, id))
    .run();
  return (await getLoop(id))!;
}

export async function setLoopEnabled(id: string, enabled: boolean): Promise<LoopView> {
  if (!(await getLoop(id))) throw new Error("Loop not found");
  await db().update(loops).set({ enabled, updatedAt: new Date() }).where(eq(loops.id, id)).run();
  return (await getLoop(id))!;
}

export async function deleteLoop(id: string): Promise<void> {
  await db().delete(loops).where(eq(loops.id, id)).run();
}

/**
 * The first matching loop wins, so a person has to be able to say which comes
 * first. Swapping with the neighbour keeps that to one obvious gesture.
 */
export async function moveLoop(id: string, direction: "up" | "down"): Promise<LoopView[]> {
  const ordered = await db().select().from(loops).orderBy(asc(loops.priority)).all();
  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) throw new Error("Loop not found");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered.map(toView);

  const moving = ordered[index]!;
  const neighbour = ordered[target]!;
  await db().transaction(async (tx) => {
    await tx.update(loops).set({ priority: neighbour.priority }).where(eq(loops.id, moving.id)).run();
    await tx.update(loops).set({ priority: moving.priority }).where(eq(loops.id, neighbour.id)).run();
  });
  return await listLoops();
}

/**
 * A loop can be written before anything is connected or installed, so the page
 * says what is still missing rather than refusing to save.
 */
export async function loopReadiness(): Promise<LoopReadiness> {
  const agents = await listAgents();
  const connected = await db()
    .selectDistinct({ connectorId: connections.connectorId })
    .from(connections)
    .all();
  const available = await availableAgentIds();
  const host = await availableAgentIds(true);
  const chosen = agents.find((agent) => agent.isDefault)?.agentId ?? null;
  const defaultAgentId =
    (chosen && available.includes(chosen) ? chosen : null) ??
    (available.length === 1 ? available[0]! : null);
  return {
    connectedConnectorIds: connected.map((row) => row.connectorId),
    defaultAgentId,
    availableAgentIds: available,
    hostAgentIds: host,
  };
}
