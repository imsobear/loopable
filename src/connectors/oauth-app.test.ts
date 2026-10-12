import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthAppRegistration, shippedOAuthApp } from "./oauth-app.ts";

const previousId = process.env.LOOPABLE_GITHUB_CLIENT_ID;
const previousSecret = process.env.LOOPABLE_GITHUB_CLIENT_SECRET;
const previousBase = process.env.LOOPABLE_BASE_URL;

afterEach(() => {
  restore("LOOPABLE_GITHUB_CLIENT_ID", previousId);
  restore("LOOPABLE_GITHUB_CLIENT_SECRET", previousSecret);
  restore("LOOPABLE_BASE_URL", previousBase);
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("oauth app registration", () => {
  it("ships GitHub and Gmail so the user only authorizes", () => {
    expect(shippedOAuthApp("github")?.clientId).toBeTruthy();
    expect(shippedOAuthApp("gmail")?.clientId).toBeTruthy();
  });

  it("lets env override the shipped GitHub app", () => {
    process.env.LOOPABLE_GITHUB_CLIENT_ID = "from-env";
    process.env.LOOPABLE_GITHUB_CLIENT_SECRET = "from-env-secret";
    expect(oauthAppRegistration("github")).toEqual({
      clientId: "from-env",
      clientSecret: "from-env-secret",
    });
  });

  it("does not use the shipped apps at a public address, whose callback is loopback", () => {
    // Away from any config/oauth-app.json this checkout happens to have.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "loopable-oauth-")));
    delete process.env.LOOPABLE_GITHUB_CLIENT_ID;
    delete process.env.LOOPABLE_GITHUB_CLIENT_SECRET;
    process.env.LOOPABLE_BASE_URL = "https://loop.example";
    expect(oauthAppRegistration("github")).toBeNull();
    process.env.LOOPABLE_GITHUB_CLIENT_ID = "hosted";
    process.env.LOOPABLE_GITHUB_CLIENT_SECRET = "hosted-secret";
    expect(oauthAppRegistration("github")?.clientId).toBe("hosted");
    cwd.mockRestore();
  });
});
