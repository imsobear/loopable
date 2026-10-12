import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { signInHref } from "@/components/sign-in";
import { startFlow } from "./flow.ts";
import { startFooter } from "./footer.ts";
import html from "./landing.html?raw";
import landingCss from "./landing.css?url";

const TITLE = "Loopable — workflows for your coding agent";
const DESCRIPTION =
  "Put the coding agent you already have to work. Loopable watches GitHub, Slack, Lark, email, and the clock, and hands each job to Codex, Claude Code, or Cursor Agent on your own machine.";
const ORIGIN = "https://loop.goodone.si";

/** What the front page puts in <head>: its own styles, and how it looks when shared. */
export const landingHead = () => ({
  meta: [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${ORIGIN}/` },
    { property: "og:image", content: `${ORIGIN}/og.png` },
    { property: "og:image:width", content: "2400" },
    { property: "og:image:height", content: "1260" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "twitter:image", content: `${ORIGIN}/og.png` },
  ],
  links: [{ rel: "stylesheet", href: landingCss }],
});

/**
 * The front page. Written as plain HTML, carried over from the old marketing
 * site, so it is set as markup rather than rebuilt in JSX; the two scripts it
 * had are started here and stopped when the page is left.
 */
export function Landing({ next, error }: { next?: string; error?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = root.current;
    if (!page) return;
    // Every sign-in link comes back to wherever the visitor was trying to go.
    if (next) {
      for (const link of page.querySelectorAll<HTMLAnchorElement>("a[data-provider]")) {
        link.href = signInHref(next, link.dataset.provider === "google" ? "google" : "github");
      }
    }
    const stops: Array<() => void> = [];
    const flow = page.querySelector<HTMLElement>("#flow");
    if (flow) stops.push(startFlow(flow));
    const stage = page.querySelector<HTMLElement>("#foot-stage");
    const canvas = page.querySelector("#loop-canvas");
    const count = page.querySelector<HTMLElement>("#run-count");
    if (stage && canvas instanceof HTMLCanvasElement && count) stops.push(startFooter(stage, canvas, count));
    return () => {
      for (const stop of stops) stop();
    };
  }, [next]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return <div ref={root} className="landing" dangerouslySetInnerHTML={{ __html: html }} />;
}
