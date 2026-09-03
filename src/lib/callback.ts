/**
 * Providers that allow loopback redirects require the literal 127.0.0.1 rather
 * than "localhost", and a dev server usually advertises localhost, so callback
 * URLs are always rebuilt on the loopback literal with the port in use.
 */
export function callbackUrl(requestUrl: string, connectorId: string): string {
  return `${appOrigin(requestUrl)}/api/connectors/${connectorId}/callback`;
}

/**
 * The URL to register with the provider. Loopback matching ignores the port, so
 * one portless registration covers every port Loopable might run on.
 */
export function registrableCallbackUrl(connectorId: string): string {
  return `http://127.0.0.1/api/connectors/${connectorId}/callback`;
}

export function appOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `http://127.0.0.1${url.port ? `:${url.port}` : ""}`;
}
