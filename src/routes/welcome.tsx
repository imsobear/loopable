import { createFileRoute } from "@tanstack/react-router";
import { Landing, landingHead } from "@/landing/landing";

/** The front page for anyone, signed in or not, and on a local install. */
export const Route = createFileRoute("/welcome")({
  head: landingHead,
  component: () => <Landing />,
});
