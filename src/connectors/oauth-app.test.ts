import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthAppRegistration } from "./oauth-app.ts";

const previousId = process.env.LOOPABLE_GITHUB_CLIENT_ID;
const previousSecret = process.env.LOOPABLE_GITHUB_CLIENT_SECRET;
const previousBase = process.env.LOOPABLE_BASE_URL;
const previousDesktop = process.env.LOOPABLE_DESKTOP;

afterEach(() => {
  restore("LOOPABLE_GITHUB_CLIENT_ID", previousId);
  restore("LOOPABLE_GITHUB_CLIENT_SECRET", previousSecret);
  restore("LOOPABLE_BASE_URL", previousBase);
  restore("LOOPABLE_DESKTOP", previousDesktop);
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("oauth app registration", () => {
  it("takes the app from env", () => {
    process.env.LOOPABLE_GITHUB_CLIENT_ID = "from-env";
    process.env.LOOPABLE_GITHUB_CLIENT_SECRET = "from-env-secret";
    expect(oauthAppRegistration("github")).toEqual({
      clientId: "from-env",
      clientSecret: "from-env-secret",
    });
  });

  it("takes a client ID alone in the desktop app, which keeps no secret", () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "loopable-oauth-")));
    process.env.LOOPABLE_GITHUB_CLIENT_ID = "public-id";
    delete process.env.LOOPABLE_GITHUB_CLIENT_SECRET;
    delete process.env.LOOPABLE_DESKTOP;
    expect(oauthAppRegistration("github")).toBeNull();
    process.env.LOOPABLE_DESKTOP = "1";
    expect(oauthAppRegistration("github")).toEqual({ clientId: "public-id", clientSecret: "" });
    cwd.mockRestore();
  });

  it("has no app built in", () => {
    // Away from any config/oauth-app.json this checkout happens to have.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "loopable-oauth-")));
    delete process.env.LOOPABLE_GITHUB_CLIENT_ID;
    delete process.env.LOOPABLE_GITHUB_CLIENT_SECRET;
    delete process.env.LOOPABLE_BASE_URL;
    expect(oauthAppRegistration("github")).toBeNull();
    expect(oauthAppRegistration("gmail")).toBeNull();
    cwd.mockRestore();
  });
});
