import { describe, expect, it } from "vitest";
import { olderThan } from "./version.ts";

describe("olderThan", () => {
  it("compares x.y.z numerically", () => {
    expect(olderThan("0.2.1", "0.3.0")).toBe(true);
    expect(olderThan("0.10.0", "0.9.9")).toBe(false);
    expect(olderThan("0.3.0", "0.3.0")).toBe(false);
  });

  it("treats no version as older", () => {
    expect(olderThan(null, "0.3.0")).toBe(true);
  });
});
