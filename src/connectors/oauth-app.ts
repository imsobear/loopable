import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type OAuthAppRegistration = {
  clientId: string;
  clientSecret: string;
};

/**
 * App registrations Loopable ships. End users never set these; they only click
 * Connect. A client on the user's machine cannot keep clientSecret confidential,
 * which both GitHub and Google accept for public clients. PKCE is what secures
 * the exchange. Env or config/oauth-app.json override this for GitHub Enterprise
 * or a private registration.
 */
const SHIPPED: Record<string, OAuthAppRegistration> = {
  github: {
    clientId: "Ov23lilxTpmZdHyRCH5f",
    clientSecret: "478c0e954e7c573763f128ba80054aca3fe5724e",
  },
  gmail: {
    clientId: "477908327191-4juu8vo8bffs63hoqlul1u2fqdch27i7.apps.googleusercontent.com",
    clientSecret: "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",
  },
};

export function shippedOAuthApp(connectorId: string): OAuthAppRegistration | null {
  return SHIPPED[connectorId] ?? null;
}

export function oauthAppRegistration(connectorId: string): OAuthAppRegistration | null {
  return fromEnv(connectorId) ?? fromFile(connectorId) ?? shippedOAuthApp(connectorId);
}

/** LOOPABLE_GITHUB_CLIENT_ID and friends, for a private or Enterprise app. */
function fromEnv(connectorId: string): OAuthAppRegistration | null {
  const prefix = `LOOPABLE_${connectorId.toUpperCase()}_CLIENT_`;
  return pick(process.env[`${prefix}ID`], process.env[`${prefix}SECRET`]);
}

/**
 * Optional override in config/oauth-app.json. Gitignored. Either an object per
 * connector or, for GitHub alone, the two keys at the top level.
 */
function fromFile(connectorId: string): OAuthAppRegistration | null {
  let file: string;
  try {
    file = join(process.cwd(), "config", "oauth-app.json");
    if (!existsSync(file)) return null;
  } catch {
    return null;
  }
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
