import { eq } from "drizzle-orm";
import type { JsonValue } from "#/lib/domain.ts";
import { db } from "./db/client.ts";
import { appSettings } from "./db/schema.ts";

export function readSetting<T extends JsonValue>(key: string, fallback: T): T {
  const row = db().select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row === undefined ? fallback : (row.value as T);
}

export function writeSetting(key: string, value: JsonValue): void {
  db()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .run();
}

/**
 * How hard the engine is allowed to pull. One run at a time by default,
 * because an agent run is minutes of CPU and real money, and two of them
 * racing is rarely what anyone wanted.
 */
export type EngineSettings = {
  paused: boolean;
  maxConcurrentRuns: number;
};

export const ENGINE_DEFAULTS: EngineSettings = { paused: false, maxConcurrentRuns: 1 };

const PAUSED_KEY = "engine.paused";
const CONCURRENCY_KEY = "engine.maxConcurrentRuns";

export function engineSettings(): EngineSettings {
  const concurrency = readSetting<number>(CONCURRENCY_KEY, ENGINE_DEFAULTS.maxConcurrentRuns);
  return {
    paused: readSetting<boolean>(PAUSED_KEY, ENGINE_DEFAULTS.paused) === true,
    maxConcurrentRuns: Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1,
  };
}

export function setEnginePaused(paused: boolean): EngineSettings {
  writeSetting(PAUSED_KEY, paused);
  return engineSettings();
}
