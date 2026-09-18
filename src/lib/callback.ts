import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

function configuredOrigin(): string | null {
  const base = process.env.LOOPABLE_BASE_URL?.replace(/\/$/, "");
  return base || null;
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/**
 * RFC1918, link-local, and loopback. A LAN App can use these as the join URL;
 * GitHub and Google will not take them as an OAuth redirect.
 */
function isPrivateHostname(hostname: string): boolean {
  if (isLoopbackHost(hostname)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const host = hostname.toLowerCase();
  if (host.includes(":")) {
    if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  }
  return false;
}

/** Public https origin for cloud. LAN and loopback BASE_URL do not count. */
function publicConfiguredOrigin(): string | null {
  const base = configuredOrigin();
  if (!base) return null;
  try {
    const url = new URL(base);
    if (isPrivateHostname(url.hostname)) return null;
    return base;
  } catch {
    return null;
  }
}

/** Where GitHub / Gmail send the browser back. Local is always loopback. */
export function appOrigin(requestUrl: string): string {
  const hosted = publicConfiguredOrigin();
  if (hosted) return hosted;
  const url = new URL(requestUrl);
  return `http://127.0.0.1${url.port ? `:${url.port}` : ""}`;
}

export function callbackUrl(requestUrl: string, connectorId: string): string {
  return `${appOrigin(requestUrl)}/api/connectors/${connectorId}/callback`;
}

export function registrableCallbackUrl(connectorId: string): string {
  const hosted = publicConfiguredOrigin();
  if (hosted) return `${hosted}/api/connectors/${connectorId}/callback`;
  return `http://127.0.0.1/api/connectors/${connectorId}/callback`;
}

/** First non-internal IPv4, preferring typical LAN ranges. */
export function lanIPv4(
  nics: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | null {
  const found: string[] = [];
  for (const addrs of Object.values(nics)) {
    for (const addr of addrs ?? []) {
      if (addr.internal) continue;
      if (!["IPv4", "4"].includes(String(addr.family))) continue;
      found.push(addr.address);
    }
  }
  return (
    found.find((ip) => ip.startsWith("192.168.")) ??
    found.find((ip) => ip.startsWith("10.")) ??
    found.find((ip) => {
      const b = Number(ip.split(".")[1]);
      return ip.startsWith("172.") && b >= 16 && b <= 31;
    }) ??
    found[0] ??
    null
  );
}

/** Where runners should address this Loopable. A LAN IP when one exists. */
export function loopableOrigin(
  nics: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  const port = process.env.PORT ?? process.env.NITRO_PORT ?? "4321";
  return `http://${lanIPv4(nics) ?? "127.0.0.1"}:${port}`;
}
