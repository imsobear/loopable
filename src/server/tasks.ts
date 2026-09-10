import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { agentManifest } from "#/agents/manifests.ts";
import { agentRuntime } from "#/agents/runtimes.ts";
import { connectorAction, connectorManifest, connectorWorkflow } from "#/connectors/manifests.ts";
import { connectorRuntime } from "#/connectors/runtimes.ts";
import type {
  ActionDescriptor,
  Signal,
  WorkItem,
  WorkItemRef,
  WorkflowDescriptor,
} from "#/connectors/types.ts";
import type { JsonValue, TaskView, WorkItemKind } from "#/lib/domain.ts";
import { REVIEW_FORMAT, anchorFindings, parseReview, reviewBody, type Finding } from "#/lib/review.ts";
import { listAgents, settingsFor } from "./agents.ts";
import { closeCheckout, measure, openCheckout } from "./checkout.ts";
import { credentialForConnector } from "./connections.ts";
import { commitAll, hasChanges } from "./git.ts";
import { db } from "./db/client.ts";
import { dataDir, runDir } from "./paths.ts";
import { loops, tasks, type Loop, type Task } from "./db/schema.ts";

/**
 * The agent says this when the honest answer is "nothing". Without it a loop
 * that runs by itself would post filler, which is worse than silence.
 */
const NOTHING = "NOTHING_TO_DO";

/**
 * The answer is the checkout, not the reply, so the reply is asked for as the
 * account somebody reads before deciding whether to look at the diff.
 *
 * The branch is made and committed by Loopable afterwards. An agent told to
 * commit would also be an agent that might push, and what it pushed to would
 * be whatever it inferred.
 */
const CODE_FORMAT = [
  "Make the change in the working directory. It is a scratch checkout made for",
  "you, so edit files freely; do not commit, branch, push, or run git at all.",
  "",
  "Then reply with the description of a pull request: a first line under about",
  "seventy characters saying what it does, a blank line, and a short account of",
  "what you changed and anything you were unsure about. No preamble.",
].join("\n");

/** Written work should say where it came from. */
const SIGNATURE = "\n\n---\n*Written by Loopable, running locally.*";

// The payload is the connector's own record and stays on the server: it is
// the only field here that no page has any business reading.
function toView(row: Omit<Task, "sourcePayload"> & { loopName?: string | null }): TaskView {
  return {
    id: row.id,
    loopId: row.loopId,
    loopName: row.loopName ?? "Deleted loop",
    connectorId: row.connectorId,
    state: row.state,
    sourceUrl: row.sourceUrl,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    sourceTitle: row.sourceTitle,
    dryRun: row.dryRun,
    agentId: row.agentId,
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
      dryRun: tasks.dryRun,
      agentId: tasks.agentId,
      agentCommand: tasks.agentCommand,
      output: tasks.output,
      comments: tasks.comments,
      actionConnectorId: tasks.actionConnectorId,
      actionId: tasks.actionId,
      actionTarget: tasks.actionTarget,
      resultUrl: tasks.resultUrl,
      error: tasks.error,
      logPath: tasks.logPath,
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

export function listTasks(options: { loopId?: string; limit?: number } = {}): TaskView[] {
  const query = select().orderBy(desc(tasks.createdAt)).limit(options.limit ?? 100);
  const rows = options.loopId ? query.where(eq(tasks.loopId, options.loopId)).all() : query.all();
  return rows.map(toView);
}

export function getTask(id: string): TaskView | null {
  const row = select().where(eq(tasks.id, id)).get();
  return row ? toView(row) : null;
}

export function taskRow(id: string): Task | undefined {
  return db().select().from(tasks).where(eq(tasks.id, id)).get();
}

export function updateTask(id: string, values: Partial<Task>): void {
  db()
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .run();
}

/** The one place a task is created, whether a person or a poll asked for it. */
function queue(input: {
  loop: Loop;
  item: WorkItemRef;
  payload?: JsonValue;
  url: string;
  title?: string;
  dryRun: boolean;
  dedupeKey?: string;
}): TaskView {
  const id = randomUUID();
  db()
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
  return getTask(id)!;
}

/** Everything a loop needs before it can produce a task, or a reason it cannot. */
function runnable(loopId: string): Loop {
  const loop = db().select().from(loops).where(eq(loops.id, loopId)).get();
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
 * that can be slow or can fail belongs to the worker.
 */
export function enqueueTask(input: {
  loopId: string;
  url: string;
  dryRun: boolean;
}): TaskView {
  const loop = runnable(input.loopId);
  const manifest = connectorManifest(loop.connectorId)!;
  const runtime = connectorRuntime(loop.connectorId);

  // Nothing to paste, and no reason to wait for the clock: what a run started
  // by hand is about is this moment, and only the connector can say what that
  // looks like as a work item.
  if (manifest.byHand.kind === "now" && runtime.itemForNow) {
    return queue({ loop, item: runtime.itemForNow(), url: "", dryRun: input.dryRun });
  }
  if (!runtime.identifyLink) throw new Error(`${manifest.name} cannot read links.`);

  const item = runtime.identifyLink(input.url);
  if (!item) {
    throw new Error(`That does not look like a ${manifest.name} link Loopable can work on.`);
  }
  return queue({ loop, item, url: input.url, dryRun: input.dryRun });
}

/**
 * Queues a run for something a poll noticed. The title is already known, so
 * the inbox can say what the task is about before the worker has fetched
 * anything.
 */
export function enqueueSignal(input: { loop: Loop; signal: Signal }): TaskView {
  const loop = runnable(input.loop.id);
  return queue({
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

export function readTaskLog(id: string): string | null {
  const task = taskRow(id);
  if (!task?.logPath || !existsSync(task.logPath)) return null;
  const text = readFileSync(task.logPath, "utf8");
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

export function requestCancel(id: string): TaskView | null {
  const row = taskRow(id);
  if (!row) return null;
  updateTask(id, { cancelRequested: true });
  return getTask(id);
}

export class TaskCancelled extends Error {
  constructor() {
    super("Stopped before it finished.");
    this.name = "Cancelled";
  }
}

/**
 * Matched by name rather than by class. The app and the daemon load their own
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
};

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
 * Carries one queued task as far as it can get. Throws so the worker can
 * decide whether to try again; what it must never do is repeat the agent,
 * which is the only expensive part. Once output is stored, a retry picks up at
 * the write.
 */
export async function runTask(id: string, signal?: AbortSignal): Promise<TaskView> {
  const task = taskRow(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  const stop = () => {
    if (signal?.aborted || taskRow(id)?.cancelRequested) throw new TaskCancelled();
  };

  const loop = db().select().from(loops).where(eq(loops.id, task.loopId)).get();
  if (!loop) throw new Error("The loop behind this task has been deleted.");
  const workflow = connectorWorkflow(loop.connectorId, loop.workflowId);
  if (!workflow) {
    throw new Error(`${loop.connectorId} no longer offers ${loop.workflowId}.`);
  }
  const runtime = connectorRuntime(task.connectorId);
  if (!runtime.resolveWorkItem) throw new Error(`${task.connectorId} cannot run tasks.`);

  // The write can belong to another connector, with its own runtime and its
  // own account, so reading and writing are resolved apart from here on.
  const writer = connectorRuntime(task.actionConnectorId);
  if (!writer.applyAction) throw new Error(`${task.actionConnectorId} cannot write anything.`);
  const action = connectorAction(task.actionConnectorId, task.actionId);
  if (!action) throw new Error(`${task.actionConnectorId} no longer offers ${task.actionId}.`);

  stop();
  const { credential } = await credentialForConnector(task.connectorId);
  const item = await runtime.resolveWorkItem({
    url: task.sourceUrl,
    payload: task.sourcePayload ?? null,
    credential,
  });
  updateTask(id, { sourceTitle: item.title });

  // Opened before the agent and kept until the work has landed somewhere. A
  // retry skips the agent, and the branch it already built is the thing that
  // still has to be pushed.
  const checkout =
    workflow.runsIn === "checkout"
      ? await openCheckout({ repo: folderFor(loop), runDir: runDir(id), ref: item.ref, taskId: id })
      : null;

  // Null means the agent has not run; empty means it ran and had little to
  // say. Telling those apart is what stops a retry paying for the agent twice.
  let output = task.output;
  let comments = task.comments ?? [];
  if (output === null) {
    stop();
    const agentId = task.agentId ?? (await defaultAgentFor(loop.agentId));
    updateTask(id, { state: "preparing", agentId });

    const workspace = runDir(id);
    for (const file of item.context) {
      writeFileSync(join(workspace, file.name), file.body);
    }
    const logPath = join(workspace, "agent.log");
    updateTask(id, { logPath });

    // Context always lands in the run directory, never in the folder being
    // worked in: a workflow that reads someone's checkout should not leave
    // files in it.
    const result = await agentRuntime(agentId).run({
      prompt: promptFor({
        workflow,
        ask: loop.prompt,
        guidance: loop.guidance,
        item,
        files: item.context.map((file) => join(workspace, file.name)),
      }),
      cwd: checkout ? checkout.dir : workflow.runsIn === "folder" ? folderFor(loop) : workspace,
      settings: settingsFor(agentId),
      outputFile: join(workspace, "answer.txt"),
      signal,
      logFile: logPath,
    });
    updateTask(id, { agentCommand: result.command });

    if (result.aborted) throw new TaskCancelled();
    if (!result.ok) {
      // Never transient: the same prompt and the same timeout would fail again.
      throw new Error(result.detail ?? "The agent did not finish.");
    }
    const said = result.output.trim();
    // Kept before anything is made of it. When a reply will not parse, what
    // the agent actually said is the only thing worth looking at.
    writeFileSync(join(workspace, "reply.txt"), said);
    if (!said) throw new Error("The agent produced nothing.");

    // Checked before parsing, because the way out of a review is a plain word
    // rather than a document saying there is nothing to say.
    if (said.replace(/[`*_.\s]/g, "").toUpperCase() === NOTHING) {
      if (checkout) await closeCheckout(checkout);
      finish(id, task, { state: "skipped", output: said });
      return getTask(id)!;
    }

    ({ output, comments } = answerFor(workflow, action, item, said));
    if (!output && comments.length === 0) {
      throw new Error("The agent produced nothing worth posting.");
    }

    if (checkout) {
      // An agent that described a change it did not make is the ordinary way
      // this goes wrong, and an empty pull request is a worse way to report it
      // than saying there was nothing to send.
      if (!(await hasChanges(checkout.dir))) {
        await closeCheckout(checkout);
        finish(id, task, {
          state: "skipped",
          output: `Nothing was changed, though the agent said:\n\n${output}`,
        });
        return getTask(id)!;
      }
      await commitAll({ dir: checkout.dir, message: output });
    }
    updateTask(id, { output, comments });
  }

  if (task.dryRun) {
    finish(id, task, { state: "prepared" });
    return getTask(id)!;
  }

  stop();
  updateTask(id, { state: "applying" });
  const sameConnector = task.actionConnectorId === task.connectorId;
  const outcome = await writer.applyAction({
    actionId: task.actionId,
    target: task.actionTarget,
    source: {
      connectorId: task.connectorId,
      kind: item.kind,
      ref: item.ref,
      title: item.title,
      url: item.url,
      // Withheld across connectors on purpose. It is one connector's private
      // record of a conversation, and another reading it as its own would be
      // a confusing failure rather than a clear one.
      carry: sameConnector ? item.carry : undefined,
    },
    body: output + SIGNATURE,
    comments,
    changes: checkout ? { ...checkout, stat: await measure(checkout) } : undefined,
    credential: sameConnector
      ? credential
      : (await credentialForConnector(task.actionConnectorId)).credential,
  });
  // Only now. Up to here the worktree is the work, and a failure that leaves it
  // behind is a retry that costs a push instead of an agent.
  if (checkout) await closeCheckout(checkout);
  finish(id, task, { state: "done", resultUrl: outcome.url });
  return getTask(id)!;
}

function finish(id: string, task: Task, values: Partial<Task>): void {
  const started = task.startedAt?.getTime() ?? task.createdAt.getTime();
  // Every way of getting here is an attempt that came good, so whatever an
  // earlier one left behind stops being true. A task is retried, and one that
  // failed twice before working would otherwise sit in the log marked done
  // with a reason it did not work next to it.
  updateTask(id, { error: null, ...values, durationMs: Date.now() - started, leaseUntil: null });
}

export async function defaultAgentFor(pinned: string | null): Promise<string> {
  const agents = await listAgents();
  const chosen = pinned ?? agents.find((agent) => agent.isDefault)?.agentId ?? null;
  if (!chosen) throw new Error("No agent is available. Choose a default on the Agents page.");
  if (!agentManifest(chosen)) throw new Error(`Unknown agent: ${chosen}`);
  if (!agents.find((agent) => agent.agentId === chosen)?.installed) {
    throw new Error(`${chosen} is not installed on this machine.`);
  }
  return chosen;
}
