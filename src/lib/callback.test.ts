import { describe, expect, it } from "vitest";
import { appOrigin, callbackUrl, loopableOrigin, registrableCallbackUrl } from "./callback.ts";

describe("callback URLs", () => {
  it("keeps loopback when BASE_URL is unset", () => {
    delete process.env.LOOPABLE_BASE_URL;
    expect(registrableCallbackUrl("github")).toBe(
      "http://127.0.0.1/api/connectors/github/callback",
    );
    expect(appOrigin("http://localhost:4321/x")).toBe("http://127.0.0.1:4321");
  });

  it("uses BASE_URL for a hosted Loopable", () => {
    process.env.LOOPABLE_BASE_URL = "https://loopable.example";
    expect(callbackUrl("https://loopable.example/x", "github")).toBe(
      "https://loopable.example/api/connectors/github/callback",
    );
    expect(registrableCallbackUrl("github")).toBe(
      "https://loopable.example/api/connectors/github/callback",
    );
    delete process.env.LOOPABLE_BASE_URL;
  });

  it("names the origin runners join", () => {
    delete process.env.LOOPABLE_BASE_URL;
    expect(loopableOrigin()).toBe("http://127.0.0.1:4321");
    process.env.LOOPABLE_BASE_URL = "https://loopable.example/";
    expect(loopableOrigin()).toBe("https://loopable.example");
    delete process.env.LOOPABLE_BASE_URL;
  });
});
