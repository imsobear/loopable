import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type OAuthAppRegistration = {
  clientId: string;
  clientSecret: string;
};

/**
 * The OAuth app registrations that ship with Loopable, one per connector.
 *
 * Users never see these; the maintainer registers each provider once. Both
 * GitHub and Google still want a client_secret at the token endpoint even with
 * PKCE, and a client on someone's laptop cannot hide one, which both accept
 * for public clients. PKCE is what actually secures the exchange, and the
 * secret is documented as public rather than pretended to be a secret.
 */
export function oauthAppRegistration(connectorId: string): OAuthAppRegistration | null {
  return fromEnv(connectorId) ?? fromFile(connectorId);
}

/** LOOPABLE_GITHUB_CLIENT_ID and friends, which is how CI and one-offs set it. */
function fromEnv(connectorId: string): OAuthAppRegistration | null {
  const prefix = `LOOPABLE_${connectorId.toUpperCase()}_CLIENT_`;
  return pick(process.env[`${prefix}ID`], process.env[`${prefix}SECRET`]);
}

/**
 * config/oauth-app.json, either as an object per connector or, for GitHub
 * alone, as the two keys at the top level. The flat shape came first and is
 * still read, because the file is gitignored and on somebody's machine.
 */
function fromFile(connectorId: string): OAuthAppRegistration | null {
  const file = join(process.cwd(), "config", "oauth-app.json");
  if (!existsSync(file)) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const nested = parsed[connectorId];
  if (nested && typeof nested === "object") {
    const entry = nested as Partial<OAuthAppRegistration>;
    return pick(entry.clientId, entry.clientSecret);
  }
  if (connectorId !== "github") return null;
  const flat = parsed as Partial<OAuthAppRegistration>;
  return pick(flat.clientId, flat.clientSecret);
}

function pick(id: unknown, secret: unknown): OAuthAppRegistration | null {
  const clientId = typeof id === "string" ? id.trim() : "";
  const clientSecret = typeof secret === "string" ? secret.trim() : "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
