import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { isHosted } from "#/lib/hosted.ts";
import { db } from "./db/client.ts";
import { secrets } from "./db/schema.ts";
import { dataDir, secretNamespace } from "./paths.ts";

/**
 * Credentials never go in SQLite in the clear. Local runs keep them in the OS
 * keychain; a hosted App and Dispatcher share an encrypted row, keyed by
 * LOOPABLE_MASTER_KEY.
 */
export type SecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

function account(): string {
  return process.env.USER ?? "loopable";
}

function service(key: string): string {
  return `${secretNamespace()}.${key}`;
}

const keychainStore: SecretStore = {
  async get(key) {
    try {
      const out = execFileSync(
        "security",
        ["find-generic-password", "-a", account(), "-s", service(key), "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      execFileSync("security", ["delete-generic-password", "-a", account(), "-s", service(key)], {
        stdio: "ignore",
      });
    } catch {
      // nothing stored yet
    }
    execFileSync(
      "security",
      ["add-generic-password", "-a", account(), "-s", service(key), "-w", value],
      { stdio: "ignore" },
    );
  },
  async delete(key) {
    try {
      execFileSync("security", ["delete-generic-password", "-a", account(), "-s", service(key)], {
        stdio: "ignore",
      });
    } catch {
      // nothing stored
    }
  },
};

function secretFile(key: string): string {
  return join(dataDir(), `secret-${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

const fileStore: SecretStore = {
  async get(key) {
    const path = secretFile(key);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  async set(key, value) {
    const path = secretFile(key);
    writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
    chmodSync(path, 0o600);
  },
  async delete(key) {
    const path = secretFile(key);
    if (existsSync(path)) rmSync(path);
  },
};

function masterKey(): string {
  const key = process.env.LOOPABLE_MASTER_KEY?.trim();
  if (!key) {
    throw new Error("Set LOOPABLE_MASTER_KEY so App and Dispatcher can share credentials.");
  }
  return key;
}

async function aesKey(): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(masterKey()));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(plain: string): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const packed = new Uint8Array(iv.length + sealed.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(sealed), iv.length);
  return bytesToBase64(packed);
}

async function decrypt(blob: string): Promise<string> {
  const key = await aesKey();
  const packed = base64ToBytes(blob);
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(opened);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(blob: string): Uint8Array {
  const binary = atob(blob);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const tableStore: SecretStore = {
  async get(key) {
    const row = await db().select().from(secrets).where(eq(secrets.key, key)).get();
    if (!row) return null;
    return decrypt(row.value);
  },
  async set(key, value) {
    const stored = await encrypt(value);
    const now = new Date();
    const existing = await db().select().from(secrets).where(eq(secrets.key, key)).get();
    if (existing) {
      await db().update(secrets).set({ value: stored, updatedAt: now }).where(eq(secrets.key, key)).run();
      return;
    }
    await db().insert(secrets).values({ key, value: stored, updatedAt: now }).run();
  },
  async delete(key) {
    await db().delete(secrets).where(eq(secrets.key, key)).run();
  },
};

export function secretStore(): SecretStore {
  if (isHosted() || process.env.LOOPABLE_MASTER_KEY) return tableStore;
  const useKeychain = process.platform === "darwin" && process.env.LOOPABLE_KEYCHAIN !== "0";
  return useKeychain ? keychainStore : fileStore;
}

export function connectionSecretKey(connectionId: string): string {
  return `connection.${connectionId}`;
}

export async function readCredential<T>(connectionId: string): Promise<T | null> {
  const raw = await secretStore().get(connectionSecretKey(connectionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCredential(connectionId: string, credential: unknown): Promise<void> {
  await secretStore().set(connectionSecretKey(connectionId), JSON.stringify(credential));
}

export async function deleteCredential(connectionId: string): Promise<void> {
  await secretStore().delete(connectionSecretKey(connectionId));
}

export function joinTokenKey(): string {
  return "runners.join";
}

export function runnerTokenKey(runnerId: string): string {
  return `runners.token.${runnerId}`;
}
