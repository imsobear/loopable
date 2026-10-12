import { createFileRoute } from "@tanstack/react-router";
import { appOrigin } from "@/lib/callback.ts";
import { completeSignIn, sessionCookie } from "@/server/accounts.ts";

/**
 * GitHub sends a signed-in browser back here. It lives under the GitHub
 * connection's callback so one registered callback URL covers both.
 */
export const Route = createFileRoute("/api/connectors/github/callback/signin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = appOrigin(request.url);
        const url = new URL(request.url);
        const failed = (message: string) =>
          Response.redirect(`${origin}/?error=${encodeURIComponent(message)}`, 302);

        const denied = url.searchParams.get("error");
        if (denied) return failed(url.searchParams.get("error_description") ?? denied);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return failed("GitHub did not send a sign-in code back.");

        try {
          const signedIn = await completeSignIn({ code, state });
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${origin}${signedIn.returnTo ?? "/inbox"}`,
              "Set-Cookie": sessionCookie(signedIn.sessionToken, origin.startsWith("https:")),
            },
          });
        } catch (error) {
          return failed(error instanceof Error ? error.message : String(error));
        }
      },
    },
  },
});
