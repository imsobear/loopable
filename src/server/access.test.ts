import { afterEach, describe, expect, it } from "vitest";
import {
  APP_ACCESS_COOKIE,
  appAccessCookie,
  assertAppAccess,
  bearer,
  isPublicApiPath,
  readAppToken,
} from "./access.ts";

afterEach(() => {
  delete process.env.LOOPABLE_APP_TOKEN;
});

describe("assertAppAccess", () => {
  it("lets loopback through without a token", () => {
    expect(() => assertAppAccess(new Request("http://127.0.0.1:4321/inbox"))).not.toThrow();
  });

  it("refuses a hosted Loopable with no token configured", () => {
    expect(() => assertAppAccess(new Request("http://loopable.example/inbox"))).toThrow(
      "LOOPABLE_APP_TOKEN",
    );
  });

  it("accepts the token as a bearer, a query, or a cookie", () => {
    process.env.LOOPABLE_APP_TOKEN = "secret";
    expect(() =>
      assertAppAccess(
        new Request("http://loopable.example/inbox", {
          headers: { authorization: "Bearer secret" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertAppAccess(new Request("http://loopable.example/inbox?token=secret")),
    ).not.toThrow();
    expect(() =>
      assertAppAccess(
        new Request("http://loopable.example/inbox", {
          headers: { cookie: `${APP_ACCESS_COOKIE}=secret` },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects the wrong token", () => {
    process.env.LOOPABLE_APP_TOKEN = "secret";
    expect(() =>
      assertAppAccess(
        new Request("http://loopable.example/inbox", {
          headers: { authorization: "Bearer other" },
        }),
      ),
    ).toThrow("not open");
  });
});

describe("bearer", () => {
  it("reads the Authorization header", () => {
    expect(bearer(new Request("http://x", { headers: { authorization: "Bearer abc" } }))).toBe(
      "abc",
    );
    expect(bearer(new Request("http://x"))).toBe("");
  });
});

describe("readAppToken", () => {
  it("prefers bearer over query over cookie", () => {
    const request = new Request("http://x/?token=from-query", {
      headers: {
        authorization: "Bearer from-header",
        cookie: `${APP_ACCESS_COOKIE}=from-cookie`,
      },
    });
    expect(readAppToken(request)).toBe("from-header");
  });
});

describe("isPublicApiPath", () => {
  it("leaves runner and OAuth routes alone", () => {
    expect(isPublicApiPath("/api/runners/claim")).toBe(true);
    expect(isPublicApiPath("/api/connectors/github/callback")).toBe(true);
    expect(isPublicApiPath("/inbox")).toBe(false);
  });
});

describe("appAccessCookie", () => {
  it("sets a host-only cookie", () => {
    expect(appAccessCookie("secret")).toContain(`${APP_ACCESS_COOKIE}=secret`);
    expect(appAccessCookie("secret")).toContain("HttpOnly");
    expect(appAccessCookie("secret")).not.toContain("Secure");
  });

  it("marks the cookie Secure on HTTPS", () => {
    process.env.LOOPABLE_BASE_URL = "https://loopable.example";
    expect(appAccessCookie("secret")).toContain("Secure");
    delete process.env.LOOPABLE_BASE_URL;
  });
});
