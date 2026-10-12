import { createFileRoute } from "@tanstack/react-router";
import { appOrigin } from "@/lib/callback.ts";
import { isSignInProvider, startSignIn } from "@/server/accounts.ts";

/**
 * Off to GitHub, or Google with `?provider=google`, to sign in.
 * `?next=/some/page` comes back there afterwards.
 */
export const Route = createFileRoute("/api/auth/signin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = appOrigin(request.url);
        try {
          const search = new URL(request.url).searchParams;
          const asked = search.get("provider");
          const provider = isSignInProvider(asked) ? asked : "github";
          const next = search.get("next") ?? undefined;
          return Response.redirect(await startSignIn({ provider, origin, returnTo: next }), 302);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.redirect(`${origin}/?error=${encodeURIComponent(message)}`, 302);
        }
      },
    },
  },
});
