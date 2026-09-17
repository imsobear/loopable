export function callbackUrl(requestUrl: string, connectorId: string): string {
  return `${appOrigin(requestUrl)}/api/connectors/${connectorId}/callback`;
}

export function registrableCallbackUrl(connectorId: string): string {
  const base = process.env.LOOPABLE_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/api/connectors/${connectorId}/callback`;
  return `http://127.0.0.1/api/connectors/${connectorId}/callback`;
}

export function appOrigin(requestUrl: string): string {
  const base = process.env.LOOPABLE_BASE_URL?.replace(/\/$/, "");
  if (base) return base;
  const url = new URL(requestUrl);
  return `http://127.0.0.1${url.port ? `:${url.port}` : ""}`;
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/** Where runners and people should address this Loopable. */
export function loopableOrigin(): string {
  return process.env.LOOPABLE_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:4321";
}
