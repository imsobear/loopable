import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getGithubAccessToken, setGithubSession } from "../src/credentials.ts";

const ENV_KEYS = [
  "LOOPABLE_HOME",
  "LOOPABLE_KEYCHAIN",
  "GITHUB_TOKEN",
  "LOOPABLE_GITHUB_CLIENT_ID",
  "LOOPABLE_GITHUB_CLIENT_SECRET",
] as const;

// Credential storage is read from the environment on every call, so a temporary
// home plus keychain off is enough to isolate a test from the real machine.
async function withStore(fn: () => Promise<void>): Promise<void> {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  const dir = mkdtempSync(join(tmpdir(), "loopable-creds-"));
  process.env.LOOPABLE_HOME = dir;
  process.env.LOOPABLE_KEYCHAIN = "0";
  delete process.env.GITHUB_TOKEN;
  process.env.LOOPABLE_GITHUB_CLIENT_ID = "Ov23liTEST";
  process.env.LOOPABLE_GITHUB_CLIENT_SECRET = "testsecret";
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a token that has not expired is used as is", async () => {
  await withStore(async () => {
    setGithubSession({
      accessToken: "gho_fresh",
      refreshToken: "ghr_test",
      expiresAt: Date.now() + 60_000,
      login: "octocat",
    });
    assert.equal(await getGithubAccessToken(), "gho_fresh");
  });
});

test("an expired token with no refresh token counts as disconnected", async () => {
  await withStore(async () => {
    setGithubSession({ accessToken: "gho_stale", expiresAt: Date.now() - 1000 });
    assert.equal(await getGithubAccessToken(), null);
  });
});

test("a session without expiry never tries to refresh", async () => {
  await withStore(async () => {
    setGithubSession({ accessToken: "gho_nonexpiring", login: "octocat" });
    assert.equal(await getGithubAccessToken(), "gho_nonexpiring");
  });
});
