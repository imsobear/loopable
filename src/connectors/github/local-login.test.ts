import { afterEach, describe, expect, it } from "vitest";
import { forgetLocalToken, localToken } from "./local-login.ts";

const previous = process.env.LOOPABLE_DESKTOP;
afterEach(() => {
  if (previous === undefined) delete process.env.LOOPABLE_DESKTOP;
  else process.env.LOOPABLE_DESKTOP = previous;
  forgetLocalToken();
});

describe("the GitHub CLI's login", () => {
  it("is never read outside the desktop app", async () => {
    delete process.env.LOOPABLE_DESKTOP;
    let asked = false;
    const token = await localToken({ fresh: true, runner: async () => ((asked = true), { stdout: "gho_x" }) });
    expect(token).toBeNull();
    expect(asked).toBe(false);
  });

  it("reads the token in the desktop app, and keeps it a while", async () => {
    process.env.LOOPABLE_DESKTOP = "1";
    let calls = 0;
    const runner = async (bin: string, args: string[]) => {
      calls++;
      expect([bin, ...args]).toEqual(["gh", "auth", "token", "--hostname", "github.com"]);
      return { stdout: "gho_x\n" };
    };
    expect(await localToken({ fresh: true, runner })).toBe("gho_x");
    expect(await localToken({ runner })).toBe("gho_x");
    expect(calls).toBe(1);
  });

  it("is null when the CLI is missing or signed out", async () => {
    process.env.LOOPABLE_DESKTOP = "1";
    const runner = async () => {
      throw new Error("gh: not found");
    };
    expect(await localToken({ fresh: true, runner })).toBeNull();
  });
});
