import { and, eq } from "drizzle-orm";
import type { JsonValue } from "#/lib/domain.ts";
import { db } from "./db/client.ts";
import { appSettings } from "./db/schema.ts";
import { isHosted } from "#/lib/hosted.ts";
import { SYSTEM_WORKSPACE, workspaceId } from "./workspace.ts";

async function read<T extends JsonValue>(workspace: string, key: string, fallback: T): Promise<T> {
  const row = await db()
    .select()
    .from(appSettings)
    .where(and(eq(appSettings.workspaceId, workspace), eq(appSettings.key, key)))
    .get();
  return row === undefined ? fallback : (row.value as T);
}

async function write(workspace: string, key: string, value: JsonValue): Promise<void> {
  await db()
    .insert(appSettings)
    .values({ workspaceId: workspace, key, value })
    .onConflictDoUpdate({
      target: [appSettings.workspaceId, appSettings.key],
      set: { value, updatedAt: new Date() },
    })
    .run();
}

/** A setting of the workspace in scope, such as its default agent. */
export async function readSetting<T extends JsonValue>(key: string, fallback: T): Promise<T> {
  return read(workspaceId(), key, fallback);
}

export async function writeSetting(key: string, value: JsonValue): Promise<void> {
  await write(workspaceId(), key, value);
}

/** A setting of the dispatcher itself, which belongs to no workspace. */
export async function readSystemSetting<T extends JsonValue>(key: string, fallback: T): Promise<T> {
  return read(SYSTEM_WORKSPACE, key, fallback);
}

export async function writeSystemSetting(key: string, value: JsonValue): Promise<void> {
  await write(SYSTEM_WORKSPACE, key, value);
}

export async function deleteSystemSetting(key: string): Promise<void> {
  await db()
    .delete(appSettings)
    .where(and(eq(appSettings.workspaceId, SYSTEM_WORKSPACE), eq(appSettings.key, key)))
    .run();
}

/** New key first, then the old engine.* name so a database from before keeps its pause. */
export async function readSystemSettingRenamed<T extends JsonValue>(
  key: string,
  previous: string,
  fallback: T,
): Promise<T> {
  const value = await read<T | null>(SYSTEM_WORKSPACE, key, null);
  if (value !== null) return value as T;
  return read(SYSTEM_WORKSPACE, previous, fallback);
}

/**
 * How hard the dispatcher is allowed to pull. One run at a time by default,
 * because an agent run is minutes of CPU and real money, and two of them
 * racing is rarely what anyone wanted.
 */
export type DispatcherSettings = {
  paused: boolean;
  maxConcurrentRuns: number;
};

export const DISPATCHER_DEFAULTS: DispatcherSettings = { paused: false, maxConcurrentRuns: 1 };

/**
 * Hosted, the dispatcher serves everyone, so one run at a time would make each
 * person wait behind every other. The work it does itself is only preparing
 * and writing back; agents run on people's own runners.
 */
const HOSTED_CONCURRENCY = 8;

const PAUSED_KEY = "dispatcher.paused";
const CONCURRENCY_KEY = "dispatcher.maxConcurrentRuns";

export async function dispatcherSettings(): Promise<DispatcherSettings> {
  const concurrency = await readSystemSettingRenamed<number>(
    CONCURRENCY_KEY,
    "engine.maxConcurrentRuns",
    isHosted() ? HOSTED_CONCURRENCY : DISPATCHER_DEFAULTS.maxConcurrentRuns,
  );
  return {
    paused:
      (await readSystemSettingRenamed<boolean>(
        PAUSED_KEY,
        "engine.paused",
        DISPATCHER_DEFAULTS.paused,
      )) === true,
    maxConcurrentRuns: Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1,
  };
}

export async function setDispatcherPaused(paused: boolean): Promise<DispatcherSettings> {
  await writeSystemSetting(PAUSED_KEY, paused);
  return dispatcherSettings();
}
