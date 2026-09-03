import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths.ts";

/**
 * Credentials never go in SQLite. Local runs keep them in the OS keychain; the
 * interface exists so a hosted deployment can swap in a server-side vault
 * without any connector knowing the difference.
 */
export type SecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

const SERVICE_PREFIX = "loopable";

function account(): string {
  return process.env.USER ?? "loopable";
}

function service(key: string): string {
  return `${SERVICE_PREFIX}.${key}`;
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

export function secretStore(): SecretStore {
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
