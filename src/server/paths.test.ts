import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDir, dbPath, secretNamespace } from "./paths.ts";

const previousHome = process.env.LOOPABLE_HOME;
const previousDb = process.env.LOOPABLE_DB;
const previousDev = process.env.LOOPABLE_DEV;
const previousPrefix = process.env.LOOPABLE_SECRET_PREFIX;

afterEach(() => {
  restore("LOOPABLE_HOME", previousHome);
  restore("LOOPABLE_DB", previousDb);
  restore("LOOPABLE_DEV", previousDev);
  restore("LOOPABLE_SECRET_PREFIX", previousPrefix);
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("local profiles", () => {
  it("keeps deploy state in ~/.loopable", () => {
    delete process.env.LOOPABLE_HOME;
    delete process.env.LOOPABLE_DB;
    delete process.env.LOOPABLE_DEV;
    expect(dataDir()).toBe(join(homedir(), ".loopable"));
    expect(dbPath()).toBe(join(homedir(), ".loopable", "loopable.sqlite"));
    expect(secretNamespace()).toBe("loopable");
  });

  it("keeps pnpm dev state in ~/.loopable-dev", () => {
    delete process.env.LOOPABLE_HOME;
    delete process.env.LOOPABLE_DB;
    process.env.LOOPABLE_DEV = "1";
    expect(dataDir()).toBe(join(homedir(), ".loopable-dev"));
    expect(dbPath()).toBe(join(homedir(), ".loopable-dev", "loopable.sqlite"));
    expect(secretNamespace()).toBe("loopable-dev");
  });

  it("lets LOOPABLE_HOME override the profile directory", () => {
    process.env.LOOPABLE_DEV = "1";
    process.env.LOOPABLE_HOME = "/tmp/loopable-custom";
    delete process.env.LOOPABLE_DB;
    expect(dataDir()).toBe("/tmp/loopable-custom");
    expect(dbPath()).toBe(join("/tmp/loopable-custom", "loopable.sqlite"));
  });
});
