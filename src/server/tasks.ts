import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { connectorAction, connectorManifest, connectorWorkflow } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type {
  ActionDescriptor,
  Changes,
  Signal,
  WorkItem,
  WorkItemRef,
  WorkflowDescriptor,
} from "#/connectors/types.ts";
import type { JsonValue, TaskView, WorkItemKind } from "#/lib/domain.ts";
import { REVIEW_FORMAT, anchorFindings, parseReview, reviewBody, type Finding } from "#/lib/review.ts";
import { isHosted } from "#/lib/hosted.ts";
import { AGENT_NOTHING, isAgentNothing, type AgentJob } from "./agent-job.ts";
import { listAgents, settingsFor } from "./agents.ts";
import { branchFor } from "./checkout.ts";
import { credentialForConnector } from "./connections.ts";
import { db } from "./db/client.ts";
import { availableAgentIds, pickRunner } from "./runners.ts";
import { dataDir, runDir } from "./paths.ts";
import { loops, tasks, type Loop, type Task } from "./db/schema.ts";

/**
 * The agent says this when the honest answer is "nothing". Without it a loop
 * that runs by itself would post filler, which is worse than silence.
 */
const NOTHING = AGENT_NOTHING;

/**
 * The answer is the checkout, not the reply, so the reply is asked for as the
 * account somebody reads before deciding whether to look at the diff.
 */
const CODE_FORMAT = [
  "Then reply with the description of a pull request: a first line under about",
  "seventy characters saying what it does, a blank line, and a short account of",
  "what you changed and anything you were unsure about. No preamble.",
].join("\n");

/** Written work should say where it came from. */
const SIGNATURE = "\n\n---\n*Written by Loopable.*";

// The payload is the connector's own record and stays on the server: it is
// the only field here that no page has any business reading.
function toView(row: Omit<Task, "sourcePayload"> & { loopName?: string | null }): TaskView {
  return {
    id: row.id,
    loopId: row.loopId,
    loopName: row.loopName ?? (row.loopId ? "Deleted loop" : "Test run"),
    connectorId: row.connectorId,
    state: row.state,
    sourceUrl: row.sourceUrl,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    sourceTitle: row.sourceTitle,
    prompt: row.prompt ?? null,
    dryRun: row.dryRun,
    agentId: row.agentId,
    runnerId: row.runnerId,
    agentCommand: row.agentCommand,
    output: row.output,
    comments: row.comments ?? [],
    actionConnectorId: row.actionConnectorId,
    actionId: row.actionId,
    resultUrl: row.resultUrl,
    error: row.error,
    attempts: row.attempts,
    cancelRequested: row.cancelRequested,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function select() {
  return db()
    .select({
      id: tasks.id,
      loopId: tasks.loopId,
      connectorId: tasks.connectorId,
      state: tasks.state,
      sourceUrl: tasks.sourceUrl,
      sourceKind: tasks.sourceKind,
      sourceRef: tasks.sourceRef,
      sourceTitle: tasks.sourceTitle,
      prompt: tasks.prompt,
      dryRun: tasks.dryRun,
      agentId: tasks.agentId,
      runnerId: tasks.runnerId,
      agentCommand: tasks.agentCommand,
      output: tasks.output,
      comments: tasks.comments,
      actionConnectorId: tasks.actionConnectorId,
      actionId: tasks.actionId,
      actionTarget: tasks.actionTarget,
      resultUrl: tasks.resultUrl,
      error: tasks.error,
      logPath: tasks.logPath,
      logText: tasks.logText,
      attempts: tasks.attempts,
      runAfter: tasks.runAfter,
      leaseUntil: tasks.leaseUntil,
      cancelRequested: tasks.cancelRequested,
      dedupeKey: tasks.dedupeKey,
      durationMs: tasks.durationMs,
      createdAt: tasks.createdAt,
      startedAt: tasks.startedAt,
      updatedAt: tasks.updatedAt,
      loopName: loops.name,
    })
    .from(tasks)
    .leftJoin(loops, eq(tasks.loopId, loops.id));
}

export async function listTasks(options: { loopId?: string; limit?: number } = {}): Promise<TaskView[]> {
  const query = select().orderBy(desc(tasks.createdAt)).limit(options.limit ?? 100);
  const rows = options.loopId
    ? await query.where(eq(tasks.loopId, options.loopId)).all()
    : await query.all();
  return rows.map(toView);
}

export async function getTask(id: string): Promise<TaskView | null> {
  const row = await select().where(eq(tasks.id, id)).get();
  return row ? toView(row) : null;
}

export async function taskRow(id: string): Promise<Task | undefined> {
  return await db().select().from(tasks).where(eq(tasks.id, id)).get();
}

export async function updateTask(id: string, values: Partial<Task>): Promise<void> {
  await db()
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .run();
}

/** The one place a task is created, whether a person or a poll asked for it. */
async function queue(input: {
  loop: Loop;
  item: WorkItemRef;
  payload?: JsonValue;
  url: string;
  title?: string;
  dryRun: boolean;
  dedupeKey?: string;
}): Promise<TaskView> {
  const id = randomUUID();
  await db()
    .insert(tasks)
    .values({
      id,
      loopId: input.loop.id,
      connectorId: input.loop.connectorId,
      state: "queued",
      sourceUrl: input.url.trim(),
      sourceKind: input.item.kind,
      sourceRef: input.item.ref,
      sourcePayload: input.payload,
      sourceTitle: input.title,
      dryRun: input.dryRun,
      actionConnectorId: input.loop.actionConnectorId,
      actionId: input.loop.actionId,
      actionTarget: input.loop.actionTarget,
      dedupeKey: input.dedupeKey,
    })
    .run();
  return (await getTask(id))!;
}

function titleFromPrompt(prompt: string): string {
  const line = prompt.split("\n")[0]?.trim() ?? "";
  return line.slice(0, 120) || "Test run";
}

function isPromptTask(task: Pick<Task, "loopId">): boolean {
  return task.loopId == null;
}

/**
 * A free-form ask from Inbox. No loop, no connector, no write-back: the runner
 * runs the agent and the reply stays on the task.
 */
export async function enqueuePrompt(input: { prompt: string; agentId: string }): Promise<TaskView> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Write a prompt.");
  if (!agentManifest(input.agentId)) throw new Error(`Unknown agent: ${input.agentId}`);
  const available = await availableAgentIds();
  if (!available.includes(input.agentId)) {
    throw new Error("No runner is online that can run this agent.");
  }

  const id = randomUUID();
  await db()
    .insert(tasks)
    .values({
      id,
      loopId: null,
      connectorId: "prompt",
      state: "queued",
      sourceUrl: "",
      sourceKind: "prompt",
      sourceRef: "prompt",
      sourceTitle: titleFromPrompt(prompt),
      prompt,
      dryRun: false,
      agentId: input.agentId,
      actionConnectorId: "prompt",
      actionId: "none",
    })
    .run();
  return (await getTask(id))!;
}

export async function listRunnableAgents(): Promise<{ agentId: string; name: string }[]> {
  const available = new Set(await availableAgentIds());
  return (await listAgents())
    .filter((agent) => available.has(agent.agentId))
    .map((agent) => ({
      agentId: agent.agentId,
      name: agentManifest(agent.agentId)?.name ?? agent.agentId,
    }));
}

/** Everything a loop needs before it can produce a task, or a reason it cannot. */
async function runnable(loopId: string): Promise<Loop> {
  const loop = await db().select().from(loops).where(eq(loops.id, loopId)).get();
  if (!loop) throw new Error("Loop not found");

  const manifest = connectorManifest(loop.connectorId);
  if (!manifest) throw new Error(`Unknown connector: ${loop.connectorId}`);
  if (!connectorWorkflow(loop.connectorId, loop.workflowId)) {
    throw new Error(`${manifest.name} no longer offers the workflow this loop was built on.`);
  }
  if (!connectorRuntime(loop.connectorId).resolveWorkItem) {
    throw new Error(`${manifest.name} cannot run tasks yet.`);
  }

  // Checked separately because it can be another connector entirely.
  const writer = connectorManifest(loop.actionConnectorId);
  if (!writer) throw new Error(`Unknown connector: ${loop.actionConnectorId}`);
  if (!connectorRuntime(loop.actionConnectorId).applyAction) {
    throw new Error(`${writer.name} cannot write anything yet.`);
  }
  return loop;
}

/**
 * Queues a run and returns at once. Identifying the link needs no network, so
 * a typo still fails while the person is looking at the box, but everything
 * that can be slow or can fail belongs to the dispatcher.
 */
export async function enqueueTask(input: {
  loopId: string;
  url: string;
  dryRun: boolean;
}): Promise<TaskView> {
  const loop = await runnable(input.loopId);
  const manifest = connectorManifest(loop.connectorId)!;
  const runtime = connectorRuntime(loop.connectorId);

  // Nothing to paste, and no reason to wait for the clock: what a run started
  // by hand is about is this moment, and only the connector can say what that
  // looks like as a work item.
  if (manifest.byHand.kind === "now" && runtime.itemForNow) {
    return await queue({ loop, item: runtime.itemForNow(), url: "", dryRun: input.dryRun });
  }
  if (!runtime.identifyLink) throw new Error(`${manifest.name} cannot read links.`);

  const item = runtime.identifyLink(input.url);
  if (!item) {
    throw new Error(`That does not look like a ${manifest.name} link Loopable can work on.`);
  }
  return await queue({ loop, item, url: input.url, dryRun: input.dryRun });
}

/**
 * Queues a run for something a poll noticed. The title is already known, so
 * the inbox can say what the task is about before the dispatcher has fetched
 * anything.
 */
export async function enqueueSignal(input: { loop: Loop; signal: Signal }): Promise<TaskView> {
  const loop = await runnable(input.loop.id);
  return await queue({
    loop,
    item: input.signal,
    payload: input.signal.payload,
    url: input.signal.url,
    title: input.signal.title,
    dryRun: false,
    dedupeKey: `${loop.id}:${input.signal.key}`,
  });
}

/** The tail is what matters while a run is going; the whole thing rarely is. */
const LOG_TAIL_BYTES = 64_000;

export async function readTaskLog(id: string): Promise<string | null> {
  const task = await taskRow(id);
  if (!task) return null;
  let text = task.logText;
  if (!text && task.logPath && existsSync(task.logPath)) {
    text = readFileSync(task.logPath, "utf8");
  }
  if (!text) return null;
  if (text.length <= LOG_TAIL_BYTES) return text;
  return `[earlier output not shown]\n\n${text.slice(-LOG_TAIL_BYTES)}`;
}

/**
 * Scratch directories are kept after a run so a person can see what the agent
 * was given and what it said. Kept, not kept forever.
 */
export function sweepRunDirs(maxAgeMs = 7 * 24 * 60 * 60 * 1_000): number {
  const root = join(dataDir(), "runs");
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      if (Date.now() - statSync(dir).mtimeMs < maxAgeMs) continue;
      rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // being written to, or already gone
    }
  }
  return removed;
}

export async function requestCancel(id: string): Promise<TaskView | null> {
  const row = await taskRow(id);
  if (!row) return null;
  await updateTask(id, { cancelRequested: true });
  return await getTask(id);
}

export class TaskCancelled extends Error {
  constructor() {
    super("Stopped before it finished.");
    this.name = "Cancelled";
  }
}

/**
 * Matched by name rather than by class. The app and the dispatcher load their own
 * copy of every module, so instanceof cannot be relied on to travel.
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof TaskCancelled || (error as Error | null)?.name === "Cancelled";
}

/**
 * The directory a loop says its agent should work in. Checked here rather than
 * left to the agent, which would otherwise run somewhere unexpected and answer
 * confidently about the wrong code.
 */
function folderFor(loop: Loop): string {
  const folder = typeof loop.settings.folder === "string" ? loop.settings.folder.trim() : "";
  if (!folder) throw new Error("This loop has no folder set. Set one and try again.");
  if (!isAbsolute(folder)) throw new Error(`The folder must be an absolute path: ${folder}`);
  if (!existsSync(folder)) throw new Error(`There is no folder at ${folder}.`);
  if (!statSync(folder).isDirectory()) throw new Error(`${folder} is not a folder.`);
  return folder;
}

const KIND_NOUN: Record<WorkItemKind, string> = {
  pull_request: "pull request",
  issue: "issue",
  message: "the message",
  email: "the email",
  occurrence: "the run due at",
  prompt: "the prompt",
};

function checkoutInstructions(item: WorkItem, branch: string | undefined, writesCode: boolean): string[] {
  const checkout = item.checkout;
  if (!checkout) return [];
  const at = checkout.sha ? `${checkout.ref} (${checkout.sha})` : checkout.ref;
  if (writesCode && branch) {
    return [
      `Clone ${checkout.url} and check out ${at}.`,
      `Commit your change and push it to ${branch}. Do not open a pull request; Loopable will.`,
      ``,
    ];
  }
  return [
    `Clone ${checkout.url} and check out ${at}. Work in that checkout. Do not commit or push.`,
    ``,
  ];
}

/**
 * What the agent is actually sent.
 *
 * The loop supplies the job and, if it has anything to add, its guidance after
 * it. What shape the answer must take is not either of theirs: it is what the
 * code downstream is able to read, so it is appended here and neither of them
 * has to know about it.
 */
function promptFor(input: {
  workflow: WorkflowDescriptor;
  ask: string;
  guidance: string | null;
  item: WorkItem;
  files: string[];
  branch?: string;
}): string {
  const shape =
    input.workflow.answer === "review"
      ? [REVIEW_FORMAT]
      : input.workflow.answer === "code"
        ? [CODE_FORMAT]
        : [`Reply with only the text to post. No preamble, no explanation of what you are about to do.`];

  return [
    `You are working on ${KIND_NOUN[input.item.kind]} ${input.item.ref}.`,
    // A run that happens because a time came round has no material: there is
    // nothing to read, and telling it to read nothing reads as a mistake.
    ...(input.files.length > 0 ? [`Read ${input.files.join(" and ")} first.`] : []),
    ``,
    ...checkoutInstructions(input.item, input.branch, input.workflow.answer === "code"),
    `Your task:`,
    input.ask,
    ...(input.guidance ? [``, `From the person who set this up:`, input.guidance] : []),
    ``,
    ...shape,
    ``,
    `If there is genuinely nothing worth posting, reply with exactly ${NOTHING}.`,
  ].join("\n");
}

/**
 * Turns what the agent said into what will be posted. A review is parsed and
 * its findings checked against the diff; anything that cannot be attached to a
 * line goes into the body with its location written out, because losing the
 * point is worse than losing its position.
 */
function answerFor(
  workflow: WorkflowDescriptor,
  action: ActionDescriptor,
  item: WorkItem,
  text: string,
): { output: string; comments: Finding[] } {
  if (workflow.answer !== "review") return { output: text, comments: [] };

  const { summary, findings } = parseReview(text);
  // Where a review goes is a choice a loop makes; whether it says everything
  // it found is not. An action with no lines to attach to gets every point
  // written into the body instead of losing them.
  const { comments, loose } = action.accepts.includes("review")
    ? anchorFindings(findings, item.commentable)
    : { comments: [] as Finding[], loose: findings };
  const body = reviewBody(summary, loose);
  // An agent that went straight to the lines leaves nothing for the body, and
  // a review whose body is only a signature reads like a mistake.
  return { output: body || "Comments are on the lines they are about.", comments };
}

/**
 * Dispatcher work on a task: prepare context and park it for a runner, or apply a
 * write once the agent has finished. The agent itself always runs through
 * `runAssignedAgent`.
 */
export async function runTask(id: string, signal?: AbortSignal): Promise<TaskView> {
  const task = await taskRow(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.state === "applying" || (task.output !== null && task.state === "queued")) {
    return await applyTask(id, signal);
  }
  if (task.state === "queued" || task.state === "preparing") {
    return await prepareTask(id, signal);
  }
  return (await getTask(id))!;
}

async function loadWork(id: string, signal?: AbortSignal) {
  const task = await taskRow(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (signal?.aborted || task.cancelRequested) throw new TaskCancelled();
  if (isPromptTask(task)) throw new Error("A prompt run has no work item to load.");
  if (!task.loopId) throw new Error("The loop behind this task has been deleted.");

  const loop = await db().select().from(loops).where(eq(loops.id, task.loopId)).get();
  if (!loop) throw new Error("The loop behind this task has been deleted.");
  const workflow = connectorWorkflow(loop.connectorId, loop.workflowId);
  if (!workflow) {
    throw new Error(`${loop.connectorId} no longer offers ${loop.workflowId}.`);
  }
  const runtime = connectorRuntime(task.connectorId);
  if (!runtime.resolveWorkItem) throw new Error(`${task.connectorId} cannot run tasks.`);
  const writer = connectorRuntime(task.actionConnectorId);
  if (!writer.applyAction) throw new Error(`${task.actionConnectorId} cannot write anything.`);
  const action = connectorAction(task.actionConnectorId, task.actionId);
  if (!action) throw new Error(`${task.actionConnectorId} no longer offers ${task.actionId}.`);

  const { credential } = await credentialForConnector(task.connectorId);
  const item = await runtime.resolveWorkItem({
    url: task.sourceUrl,
    payload: task.sourcePayload ?? null,
    credential,
  });
  return { task, loop, workflow, writer, action, credential, item };
}

async function preparePromptTask(id: string, signal?: AbortSignal): Promise<TaskView> {
  const task = (await taskRow(id))!;
  if (signal?.aborted || task.cancelRequested) throw new TaskCancelled();
  if (!task.agentId) throw new Error("This task has no agent yet.");
  let logPath: string | null = null;
  if (!isHosted()) {
    const workspace = runDir(id);
    logPath = join(workspace, "agent.log");
    writeFileSync(logPath, "", { flag: "a" });
  }
  const runnerId = await pickRunner({ agentId: task.agentId, requiresHost: false });
  await updateTask(id, {
    state: "awaiting_agent",
    runnerId,
    logPath,
    leaseUntil: null,
  });
  return (await getTask(id))!;
}

async function prepareTask(id: string, signal?: AbortSignal): Promise<TaskView> {
  const existing = await taskRow(id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  if (isPromptTask(existing)) return await preparePromptTask(id, signal);

  const { loop, workflow, item } = await loadWork(id, signal);
  await updateTask(id, { sourceTitle: item.title });

  const task = (await taskRow(id))!;
  const agentId = task.agentId ?? (await defaultAgentFor(loop.agentId));
  let logPath: string | null = null;
  if (!isHosted()) {
    const workspace = runDir(id);
    for (const file of item.context) {
      writeFileSync(join(workspace, file.name), file.body);
    }
    logPath = join(workspace, "agent.log");
    writeFileSync(logPath, "", { flag: "a" });
  }
  const runnerId = await pickRunner({
    agentId,
    requiresHost: workflow.runsIn === "folder",
  });
  await updateTask(id, {
    state: "awaiting_agent",
    agentId,
    runnerId,
    logPath,
    leaseUntil: null,
  });
  return (await getTask(id))!;
}

export async function jobForTask(id: string): Promise<AgentJob> {
  const existing = await taskRow(id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  if (isPromptTask(existing)) {
    if (!existing.agentId) throw new Error("This task has no agent yet.");
    if (!existing.prompt) throw new Error("This task has no prompt.");
    return {
      taskId: id,
      agentId: existing.agentId,
      prompt: existing.prompt,
      settings: await settingsFor(existing.agentId),
      files: [],
    };
  }

  const { task, loop, workflow, item } = await loadWork(id);
  if (!task.agentId) throw new Error("This task has no agent yet.");
  const workspace = runDir(id);
  const cwd = workflow.runsIn === "folder" ? folderFor(loop) : undefined;
  const branch = workflow.answer === "code" ? branchFor({ ref: item.ref, taskId: id }) : undefined;
  const settings = { ...(await settingsFor(task.agentId)) };
  // Clone needs a writable workspace and network. A global read-only default
  // would make every GitHub checkout job fail before the agent started.
  if (item.checkout && settings.permissionMode === "read_only") {
    settings.permissionMode = "workspace_write";
  }
  return {
    taskId: id,
    agentId: task.agentId,
    prompt: promptFor({
      workflow,
      ask: loop.prompt,
      guidance: loop.guidance,
      item,
      // Folder jobs work in a checkout that does not hold these files, so the
      // prompt has to name them by their dispatcher path. Everything else runs
      // where the runner wrote them, so the basename is enough.
      files: item.context.map((file) => (cwd ? join(workspace, file.name) : file.name)),
      branch,
    }),
    settings,
    files: item.context.map((file) => ({ name: file.name, body: file.body })),
    ...(cwd ? { cwd } : {}),
  };
}

/** The runner's half: invoke the agent for a task that is already awaiting it. */
export async function runAssignedAgent(id: string, signal?: AbortSignal): Promise<TaskView> {
  const task = await taskRow(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.output !== null) return (await getTask(id))!;

  const job = await jobForTask(id);
  const { runAgentJob } = await import("./agent-runner.ts");
  const result = await runAgentJob(job, { signal });
  await updateTask(id, { agentCommand: result.command });
  if (result.aborted) throw new TaskCancelled();
  if (!result.ok) throw new Error(result.detail ?? "The agent did not finish.");
  return await absorbAgentOutput(id, result.output);
}

function changesFrom(item: WorkItem, taskId: string): Changes | undefined {
  if (!item.checkout) return undefined;
  return {
    branch: branchFor({ ref: item.ref, taskId }),
    base: item.checkout.base,
    repo: item.checkout.repo,
    stat: "",
  };
}

export async function absorbAgentOutput(id: string, raw: string): Promise<TaskView> {
  const existing = await taskRow(id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  if (isPromptTask(existing)) {
    const workspace = runDir(id);
    const said = raw.trim();
    writeFileSync(join(workspace, "reply.txt"), said);
    if (!said) throw new Error("The agent produced nothing.");
    if (isAgentNothing(said)) {
      await finish(id, existing, { state: "skipped", output: said });
      return (await getTask(id))!;
    }
    await updateTask(id, { output: said, comments: [] });
    await finish(id, existing, { state: "prepared" });
    return (await getTask(id))!;
  }

  const { task, workflow, action, item } = await loadWork(id);
  const workspace = runDir(id);
  const said = raw.trim();
  writeFileSync(join(workspace, "reply.txt"), said);
  if (!said) throw new Error("The agent produced nothing.");

  if (isAgentNothing(said)) {
    await finish(id, task, { state: "skipped", output: said });
    return (await getTask(id))!;
  }

  const parsed = answerFor(workflow, action, item, said);
  if (!parsed.output && parsed.comments.length === 0) {
    throw new Error("The agent produced nothing worth posting.");
  }

  await updateTask(id, { output: parsed.output, comments: parsed.comments });
  if (task.dryRun) {
    await finish(id, task, { state: "prepared" });
    return (await getTask(id))!;
  }
  await updateTask(id, { state: "applying", leaseUntil: null });
  return (await getTask(id))!;
}

async function applyTask(id: string, signal?: AbortSignal): Promise<TaskView> {
  const { task, workflow, writer, credential, item } = await loadWork(id, signal);
  const output = task.output;
  const comments = task.comments ?? [];
  if (output === null) throw new Error("Nothing to write back yet.");

  if (task.dryRun) {
    await finish(id, task, { state: "prepared" });
    return (await getTask(id))!;
  }

  await updateTask(id, { state: "applying" });
  const sameConnector = task.actionConnectorId === task.connectorId;
  const apply = writer.applyAction;
  if (!apply) throw new Error(`${task.actionConnectorId} cannot write anything.`);
  const outcome = await apply({
    actionId: task.actionId,
    target: task.actionTarget,
    source: {
      connectorId: task.connectorId,
      kind: item.kind,
      ref: item.ref,
      title: item.title,
      url: item.url,
      carry: sameConnector ? item.carry : undefined,
    },
    body: output + SIGNATURE,
    comments,
    changes: workflow.answer === "code" ? changesFrom(item, id) : undefined,
    credential: sameConnector
      ? credential
      : (await credentialForConnector(task.actionConnectorId)).credential,
  });
  await finish(id, task, { state: "done", resultUrl: outcome.url });
  return (await getTask(id))!;
}

async function finish(id: string, task: Task, values: Partial<Task>): Promise<void> {
  const started = task.startedAt?.getTime() ?? task.createdAt.getTime();
  // Every way of getting here is an attempt that came good, so whatever an
  // earlier one left behind stops being true. A task is retried, and one that
  // failed twice before working would otherwise sit in the log marked done
  // with a reason it did not work next to it.
  await updateTask(id, { error: null, ...values, durationMs: Date.now() - started, leaseUntil: null });
}

export async function defaultAgentFor(pinned: string | null): Promise<string> {
  if (pinned) {
    if (!agentManifest(pinned)) throw new Error(`Unknown agent: ${pinned}`);
    return pinned;
  }
  const available = await availableAgentIds();
  const agents = await listAgents();
  const chosen = agents.find((agent) => agent.isDefault)?.agentId ?? null;
  if (chosen && available.includes(chosen)) return chosen;
  if (available.length === 1) return available[0]!;
  throw new Error("No agent is available. Start a runner with an agent signed in.");
}
