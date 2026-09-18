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
};

/**
 * One dispatcher process. The App Worker wakes it; it stays up, polls, and
 * moves tasks. Runners never talk to it.
 */
export class DispatcherContainer extends Container<DispatcherEnv> {
  defaultPort = 8080;
  sleepAfter = "24h";
  enableInternet = true;
  pingEndpoint = "/health";

  async onActivityExpired(): Promise<void> {
    this.renewActivityTimeout();
  }
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

export default {
  async fetch(request: Request, env: DispatcherEnv, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    bindProcessEnv(env);
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
    bindProcessEnv(env);
    ctx.waitUntil(wakeDispatcher(env));
  },
};
