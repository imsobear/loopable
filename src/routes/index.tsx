import { createFileRoute, redirect } from "@tanstack/react-router";
import { Landing, landingHead } from "@/landing/landing";
import { getViewer } from "@/server/functions/account.ts";

/**
 * The front page. Signed in, it is still here to read, with a way into the
 * app; a link that sent someone to sign in first (`?next=`) goes on to where
 * it was heading. Under `pnpm dev` nobody signs in, so it opens the app.
 */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { next?: string; error?: string } => ({
    ...(typeof search.next === "string" ? { next: search.next } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  beforeLoad: async ({ search }) => {
    const { hosted, viewer } = await getViewer();
    const next = search.next?.startsWith("/") && !search.next.startsWith("//") ? search.next : null;
    if (!hosted) throw redirect({ to: next ?? "/inbox" });
    if (viewer && next) throw redirect({ to: next });
    return { signedIn: Boolean(viewer) };
  },
  head: landingHead,
  component: Front,
});

function Front() {
  const { next, error } = Route.useSearch();
  const { signedIn } = Route.useRouteContext();
  return <Landing signedIn={signedIn} next={next} error={error} />;
}
