import { createFileRoute } from "@tanstack/react-router";
import { appOrigin } from "@/lib/callback.ts";
import { startSignIn } from "@/server/accounts.ts";

/** Off to GitHub to sign in. `?next=/some/page` comes back there afterwards. */
export const Route = createFileRoute("/api/auth/signin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = appOrigin(request.url);
        try {
          const next = new URL(request.url).searchParams.get("next") ?? undefined;
          return Response.redirect(await startSignIn({ origin, returnTo: next }), 302);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.redirect(`${origin}/?error=${encodeURIComponent(message)}`, 302);
        }
      },
    },
  },
});
