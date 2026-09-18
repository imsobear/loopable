import { eq } from "drizzle-orm";
import type { JsonValue } from "#/lib/domain.ts";
import { db } from "./db/client.ts";
import { appSettings } from "./db/schema.ts";

export async function readSetting<T extends JsonValue>(key: string, fallback: T): Promise<T> {
  const row = await db().select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row === undefined ? fallback : (row.value as T);
}

/** New key first, then the old engine.* name so a laptop install keeps its pause. */
export async function readSettingRenamed<T extends JsonValue>(
  key: string,
  previous: string,
  fallback: T,
): Promise<T> {
  const row = await db().select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (row !== undefined) return row.value as T;
  return readSetting(previous, fallback);
}

export async function writeSetting(key: string, value: JsonValue): Promise<void> {
  await db()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .run();
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

const PAUSED_KEY = "dispatcher.paused";
const CONCURRENCY_KEY = "dispatcher.maxConcurrentRuns";

export async function dispatcherSettings(): Promise<DispatcherSettings> {
  const concurrency = await readSettingRenamed<number>(
    CONCURRENCY_KEY,
    "engine.maxConcurrentRuns",
    DISPATCHER_DEFAULTS.maxConcurrentRuns,
  );
  return {
    paused:
      (await readSettingRenamed<boolean>(PAUSED_KEY, "engine.paused", DISPATCHER_DEFAULTS.paused)) ===
      true,
    maxConcurrentRuns: Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1,
  };
}

export async function setDispatcherPaused(paused: boolean): Promise<DispatcherSettings> {
  await writeSetting(PAUSED_KEY, paused);
  return dispatcherSettings();
}
