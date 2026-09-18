import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  appOrigin,
  callbackUrl,
  lanIPv4,
  loopableOrigin,
  registrableCallbackUrl,
} from "./callback.ts";

function nics(address: string): NodeJS.Dict<NetworkInterfaceInfo[]> {
  return {
    en0: [
      {
        address,
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: `${address}/24`,
      },
    ],
  };
}

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

  it("picks a private IPv4 for the runner join URL", () => {
    expect(lanIPv4(nics("10.0.0.8"))).toBe("10.0.0.8");
    expect(lanIPv4(nics("192.168.1.10"))).toBe("192.168.1.10");
    delete process.env.LOOPABLE_BASE_URL;
    delete process.env.PORT;
    expect(loopableOrigin(nics("192.168.1.10"))).toBe("http://192.168.1.10:4321");
    process.env.LOOPABLE_BASE_URL = "https://loopable.example/";
    expect(loopableOrigin(nics("192.168.1.10"))).toBe("https://loopable.example");
    delete process.env.LOOPABLE_BASE_URL;
  });

  it("keeps OAuth on loopback when BASE_URL is a LAN address", () => {
    process.env.LOOPABLE_BASE_URL = "http://192.168.1.10:4321";
    expect(callbackUrl("http://192.168.1.10:4321/connectors", "github")).toBe(
      "http://127.0.0.1:4321/api/connectors/github/callback",
    );
    expect(appOrigin("http://192.168.1.10:4321/x")).toBe("http://127.0.0.1:4321");
    expect(registrableCallbackUrl("github")).toBe(
      "http://127.0.0.1/api/connectors/github/callback",
    );
    expect(loopableOrigin()).toBe("http://192.168.1.10:4321");
    delete process.env.LOOPABLE_BASE_URL;
  });
});
