import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

function configuredOrigin(): string | null {
  const base = process.env.LOOPABLE_BASE_URL?.replace(/\/$/, "");
  return base || null;
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
