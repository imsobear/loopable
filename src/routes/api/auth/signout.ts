import { createFileRoute } from "@tanstack/react-router";
import { appOrigin } from "@/lib/callback.ts";
import { clearedSessionCookie, sessionTokenFrom, signOut } from "@/server/accounts.ts";

/** Ends this browser's session and goes back to the front page. */
export const Route = createFileRoute("/api/auth/signout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = appOrigin(request.url);
        await signOut(sessionTokenFrom(request));
        return new Response(null, {
          status: 303,
          headers: {
            Location: `${origin}/`,
            "Set-Cookie": clearedSessionCookie(origin.startsWith("https:")),
          },
        });
      },
    },
  },
});
