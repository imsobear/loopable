import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "#/server/db/client.ts";
import { appSettings } from "#/server/db/schema.ts";
import { readSettingRenamed, writeSetting } from "#/server/settings.ts";

const OWNER_KEY = "dispatcher.leaseOwner";
const UNTIL_KEY = "dispatcher.leaseUntil";
const HEARTBEAT_KEY = "dispatcher.heartbeatAt";
const LEASE_MS = 20_000;

function ownerId(): string {
  return process.env.LOOPABLE_DISPATCHER_ID ?? process.env.LOOPABLE_ENGINE_ID ?? randomUUID();
}

const owner = ownerId();

/**
 * Two dispatchers on one database would fight over every task. A lease in the
 * database is what a pid file was when both processes shared a disk.
 */
export async function claimSingleInstance(): Promise<{ ok: true } | { ok: false; owner: string }> {
  const now = Date.now();
  const until = Number(await readSettingRenamed<number>(UNTIL_KEY, "engine.leaseUntil", 0));
  const current = await readSettingRenamed<string>(OWNER_KEY, "engine.leaseOwner", "");
  if (until > now && current && current !== owner) {
    return { ok: false, owner: current };
  }
  await writeSetting(OWNER_KEY, owner);
  await writeSetting(UNTIL_KEY, now + LEASE_MS);
  await writeSetting(HEARTBEAT_KEY, now);
  return { ok: true };
}

export async function touchDispatcher(): Promise<void> {
  const now = Date.now();
  await writeSetting(OWNER_KEY, owner);
  await writeSetting(UNTIL_KEY, now + LEASE_MS);
  await writeSetting(HEARTBEAT_KEY, now);
}

export async function releaseSingleInstance(): Promise<void> {
  const current = await readSettingRenamed<string>(OWNER_KEY, "engine.leaseOwner", "");
  if (current !== owner) return;
  await db().delete(appSettings).where(eq(appSettings.key, OWNER_KEY)).run();
  await db().delete(appSettings).where(eq(appSettings.key, UNTIL_KEY)).run();
  await db().delete(appSettings).where(eq(appSettings.key, "engine.leaseOwner")).run();
  await db().delete(appSettings).where(eq(appSettings.key, "engine.leaseUntil")).run();
}

/** True when a dispatcher has renewed its lease recently. */
export async function dispatcherIsAlive(): Promise<boolean> {
  const until = Number(await readSettingRenamed<number>(UNTIL_KEY, "engine.leaseUntil", 0));
  return until > Date.now();
}
