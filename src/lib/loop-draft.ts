import { connectorWorkflow } from "@/connectors/manifests.ts";
import type { LoopEdit } from "@/lib/domain.ts";

/**
 * One of a connector's workflows, as a loop nobody has saved yet.
 *
 * Nothing here touches the database, which is the point: choosing a workflow
 * used to create the loop, so a look around the page left a live loop behind,
 * enabled and with none of its questions answered. Now choosing only fills a
 * form in, and the loop begins at Save.
 *
 * Deliberately client-safe, so the form can be filled in without a round trip
 * and without anything on the server having to remember a half-made loop.
 */
export function draftForWorkflow(connectorId: string, workflowId: string): LoopEdit {
  const workflow = connectorWorkflow(connectorId, workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  return {
    id: null,
    name: workflow.name,
    connectorId,
    workflowId,
    // All taken once, here. From now on they are the loop's, and improving
    // the workflow will not reword an existing loop or move where it writes.
    prompt: workflow.prompt,
    guidance: null,
    agentId: null,
    settings: {},
    // Where it reads, unless the workflow says otherwise. A connector that
    // only reads has no action of its own to fall back to.
    actionConnectorId: workflow.actionConnectorId ?? connectorId,
    actionId: workflow.actionId,
    actionTarget: workflow.actionTarget ?? {},
    pollEveryMs: workflow.pollEveryMs ?? null,
    enabled: true,
  };
}
