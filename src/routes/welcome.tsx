import { createFileRoute } from "@tanstack/react-router";
import { Landing, landingHead } from "@/landing/landing";
import { getViewer } from "@/server/functions/account.ts";

/** The front page for anyone, and on a local install too. */
export const Route = createFileRoute("/welcome")({
  beforeLoad: async () => ({ signedIn: Boolean((await getViewer()).viewer) }),
  head: landingHead,
  component: Welcome,
});

function Welcome() {
  const { signedIn } = Route.useRouteContext();
  return <Landing signedIn={signedIn} />;
}
