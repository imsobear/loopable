import { randomUUID } from "node:crypto";
import {
  deleteSystemSetting,
  readSystemSettingRenamed as readSettingRenamed,
  writeSystemSetting as writeSetting,
} from "#/server/settings.ts";

const OWNER_KEY = "dispatcher.leaseOwner";
const UNTIL_KEY = "dispatcher.leaseUntil";
const HEARTBEAT_KEY = "dispatcher.heartbeatAt";
const LEASE_MS = 20_000;

let owner: string | undefined;

/**
 * Who holds the lease: this process, named once. Worked out on first use, not
 * when the module loads, because the App Worker imports this file too and
 * Cloudflare refuses random values while a module is loading.
 */
function ownerId(): string {
  owner ??= process.env.LOOPABLE_DISPATCHER_ID ?? process.env.LOOPABLE_ENGINE_ID ?? randomUUID();
  return owner;
}

/**
 * Two dispatchers on one database would fight over every task. A lease in the
 * database is what a pid file was when both processes shared a disk.
 */
export async function claimSingleInstance(): Promise<{ ok: true } | { ok: false; owner: string }> {
  const now = Date.now();
  const until = Number(await readSettingRenamed<number>(UNTIL_KEY, "engine.leaseUntil", 0));
  const current = await readSettingRenamed<string>(OWNER_KEY, "engine.leaseOwner", "");
  if (until > now && current && current !== ownerId()) {
    return { ok: false, owner: current };
  }
  await writeSetting(OWNER_KEY, ownerId());
  await writeSetting(UNTIL_KEY, now + LEASE_MS);
  await writeSetting(HEARTBEAT_KEY, now);
  return { ok: true };
}

export async function touchDispatcher(): Promise<void> {
  const now = Date.now();
  await writeSetting(OWNER_KEY, ownerId());
  await writeSetting(UNTIL_KEY, now + LEASE_MS);
  await writeSetting(HEARTBEAT_KEY, now);
}

export async function releaseSingleInstance(): Promise<void> {
  const current = await readSettingRenamed<string>(OWNER_KEY, "engine.leaseOwner", "");
  if (current !== ownerId()) return;
  for (const key of [OWNER_KEY, UNTIL_KEY, "engine.leaseOwner", "engine.leaseUntil"]) {
    await deleteSystemSetting(key);
  }
}

/** True when a dispatcher has renewed its lease recently. */
export async function dispatcherIsAlive(): Promise<boolean> {
  const until = Number(await readSettingRenamed<number>(UNTIL_KEY, "engine.leaseUntil", 0));
  return until > Date.now();
}
