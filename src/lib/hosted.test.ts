import { describe, expect, it } from "vitest";
import { isHosted } from "./hosted.ts";

describe("isHosted", () => {
  it("is a local file database unless LOOPABLE_DATABASE_URL is remote", () => {
    const previous = process.env.LOOPABLE_DATABASE_URL;
    delete process.env.LOOPABLE_DATABASE_URL;
    expect(isHosted()).toBe(false);
    process.env.LOOPABLE_DATABASE_URL = "file:///tmp/loopable.sqlite";
    expect(isHosted()).toBe(false);
    process.env.LOOPABLE_DATABASE_URL = "libsql://loopable.example";
    expect(isHosted()).toBe(true);
    if (previous === undefined) delete process.env.LOOPABLE_DATABASE_URL;
    else process.env.LOOPABLE_DATABASE_URL = previous;
  });
});
