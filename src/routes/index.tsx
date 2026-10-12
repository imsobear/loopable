import { createFileRoute, redirect } from "@tanstack/react-router";
import { Landing, landingHead } from "@/landing/landing";
import { getViewer } from "@/server/functions/account.ts";

/**
 * The front door. Signed in, or on a local install where nobody signs in,
 * there is nothing to see here and the app opens at the Inbox.
 */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { next?: string; error?: string } => ({
    ...(typeof search.next === "string" ? { next: search.next } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  beforeLoad: async ({ search }) => {
    const { hosted, viewer } = await getViewer();
    if (!hosted || viewer) throw redirect({ to: search.next && search.next.startsWith("/") ? search.next : "/inbox" });
  },
  head: landingHead,
  component: Front,
});

function Front() {
  const { next, error } = Route.useSearch();
  return <Landing next={next} error={error} />;
}
