import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type GithubAppRegistration = {
  clientId: string;
  clientSecret: string;
};

/**
 * The single OAuth App that ships with Loopable. Users never see this; the
 * maintainer registers it once. GitHub still requires client_secret at the token
 * endpoint even with PKCE, and a client on the user's machine cannot hide it,
 * which GitHub accepts for public clients. PKCE is what secures the exchange.
 */
export function githubAppRegistration(): GithubAppRegistration | null {
  const envId = process.env.LOOPABLE_GITHUB_CLIENT_ID?.trim();
  const envSecret = process.env.LOOPABLE_GITHUB_CLIENT_SECRET?.trim();
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };

  const file = join(process.cwd(), "config", "oauth-app.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<GithubAppRegistration>;
    if (!parsed.clientId || !parsed.clientSecret) return null;
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch {
    return null;
  }
}
