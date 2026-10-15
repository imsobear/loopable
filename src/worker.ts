import { Container, getContainer } from "@cloudflare/containers";
import handler from "@tanstack/react-start/server-entry";

type DispatcherEnv = {
  DISPATCHER: DurableObjectNamespace<DispatcherContainer>;
  LOOPABLE_DATABASE_URL: string;
  LOOPABLE_DATABASE_AUTH_TOKEN: string;
  LOOPABLE_MASTER_KEY: string;
  LOOPABLE_APP_TOKEN?: string;
  LOOPABLE_BASE_URL?: string;
  LOOPABLE_GITHUB_CLIENT_ID?: string;
  LOOPABLE_GITHUB_CLIENT_SECRET?: string;
  LOOPABLE_GMAIL_CLIENT_ID?: string;
  LOOPABLE_GMAIL_CLIENT_SECRET?: string;
  LOOPABLE_SITE_ONLY?: string;
};

/**
 * One dispatcher process. The App Worker wakes it; it stays up, polls, and
 * moves tasks. Runners never talk to it.
 */
export class DispatcherContainer extends Container<DispatcherEnv> {
  defaultPort = 8080;
  // Asleep after ten idle minutes. While the hosted service ran, the cron
  // woke it every minute and it renewed its own timer, so it never slept;
  // with only the site running nothing wakes it, and this lets it stop.
  sleepAfter = "10m";
  enableInternet = true;
  pingEndpoint = "/health";
}

function dispatcherEnv(env: DispatcherEnv): Record<string, string> {
  return {
    PORT: "8080",
    LOOPABLE_DISPATCHER_ID: "container",
    LOOPABLE_DATABASE_URL: env.LOOPABLE_DATABASE_URL ?? "",
    LOOPABLE_DATABASE_AUTH_TOKEN: env.LOOPABLE_DATABASE_AUTH_TOKEN ?? "",
    LOOPABLE_MASTER_KEY: env.LOOPABLE_MASTER_KEY ?? "",
    LOOPABLE_GITHUB_CLIENT_ID: env.LOOPABLE_GITHUB_CLIENT_ID ?? "",
    LOOPABLE_GITHUB_CLIENT_SECRET: env.LOOPABLE_GITHUB_CLIENT_SECRET ?? "",
    LOOPABLE_GMAIL_CLIENT_ID: env.LOOPABLE_GMAIL_CLIENT_ID ?? "",
    LOOPABLE_GMAIL_CLIENT_SECRET: env.LOOPABLE_GMAIL_CLIENT_SECRET ?? "",
    LOOPABLE_BASE_URL: env.LOOPABLE_BASE_URL ?? "",
  };
}

function bindProcessEnv(env: DispatcherEnv): void {
  process.env.LOOPABLE_SKIP_MIGRATE ??= "1";
  const keys = [
    "LOOPABLE_DATABASE_URL",
    "LOOPABLE_DATABASE_AUTH_TOKEN",
    "LOOPABLE_MASTER_KEY",
    "LOOPABLE_APP_TOKEN",
    "LOOPABLE_BASE_URL",
    "LOOPABLE_GITHUB_CLIENT_ID",
    "LOOPABLE_GITHUB_CLIENT_SECRET",
    "LOOPABLE_GMAIL_CLIENT_ID",
    "LOOPABLE_GMAIL_CLIENT_SECRET",
  ] as const;
  for (const key of keys) {
    const value = env[key as keyof DispatcherEnv];
    if (typeof value === "string" && value) process.env[key] = value;
  }
}

async function wakeDispatcher(env: DispatcherEnv): Promise<void> {
  const dispatcher = getContainer(env.DISPATCHER);
  await dispatcher.startAndWaitForPorts({
    startOptions: { envVars: dispatcherEnv(env) },
  });
  await dispatcher.fetch("http://dispatcher/health");
}

/** The pages the site still serves, and what they need to load. */
const SITE_PATHS = new Set(["/", "/privacy", "/terms"]);

/**
 * Only the site: the front page and its legal pages. The app's pages go to
 * the front page; sign-in and the runner API say plainly where Loopable
 * went, which is what an older runner prints. Nothing touches the database.
 */
function siteOnly(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  if (SITE_PATHS.has(pathname) || pathname.startsWith("/_serverFn")) return null;
  if (pathname.startsWith("/api/")) {
    return Response.json(
      {
        error:
          "The hosted Loopable is paused while Loopable becomes a desktop app. See https://loop.goodone.si.",
      },
      { status: 410 },
    );
  }
  return Response.redirect(new URL("/", request.url).href, 302);
}

export default {
  async fetch(request: Request, env: DispatcherEnv, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    bindProcessEnv(env);
    if (env.LOOPABLE_SITE_ONLY === "1") {
      process.env.LOOPABLE_SITE_ONLY = "1";
      return siteOnly(request) ?? handler.fetch(request);
    }
    ctx.waitUntil(
      wakeDispatcher(env).catch((error: unknown) => {
        console.error("dispatcher wake failed", error);
      }),
    );
    return handler.fetch(request);
  },

  async scheduled(
    _event: unknown,
    env: DispatcherEnv,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ) {
    if (env.LOOPABLE_SITE_ONLY === "1") return;
    bindProcessEnv(env);
    ctx.waitUntil(wakeDispatcher(env));
  },
};
