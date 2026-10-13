import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { NavigationProgress } from "@/components/navigation-progress";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { getViewer } from "@/server/functions/account.ts";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Loopable" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  // Who is signed in, for the sidebar and for the front page to decide
  // whether to show itself or go straight to the app.
  loader: () => getViewer(),
  // Who is signed in only changes by signing in or out, and both load the
  // whole page again, so it is not asked for on every move between pages.
  staleTime: Number.POSITIVE_INFINITY,
  shellComponent: RootDocument,
  component: AppLayout,
});

const Devtools = import.meta.env.DEV ? lazy(() => import("@/components/devtools")) : () => null;

/** Pages that stand on their own, with no app around them. */
const BARE = new Set(["/", "/welcome", "/privacy", "/terms"]);

function AppLayout() {
  // The page on screen, not the address being loaded: while the front page
  // loads, the app page it is leaving keeps its sidebar until it is replaced.
  const routeId = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });
  if (routeId && BARE.has(routeId)) return <Outlet />;
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* No header: the only thing it held was the sidebar toggle, which now
            lives in the sidebar itself, above what it collapses. */}
        <div className="flex-1 px-6 py-8 md:px-10">
          {/* Capped and centred. Every page here is a list of sentences, and
              stretched to a wide monitor they run past the width an eye can
              track back from, while the button belonging to a row ends up a
              hand's width from the row's own words. */}
          <div className="mx-auto w-full max-w-4xl">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <NavigationProgress />
        {children}
        <Toaster />
        <Suspense fallback={null}>
          <Devtools />
        </Suspense>
        <Scripts />
      </body>
    </html>
  );
}
