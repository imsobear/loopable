import { afterEach, describe, expect, it } from "vitest";
import { oauthAppRegistration, shippedOAuthApp } from "./oauth-app.ts";

const previousId = process.env.LOOPABLE_GITHUB_CLIENT_ID;
const previousSecret = process.env.LOOPABLE_GITHUB_CLIENT_SECRET;

afterEach(() => {
  restore("LOOPABLE_GITHUB_CLIENT_ID", previousId);
  restore("LOOPABLE_GITHUB_CLIENT_SECRET", previousSecret);
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
});
