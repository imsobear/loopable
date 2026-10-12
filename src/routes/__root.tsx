import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { AppSidebar } from "@/components/app-sidebar";
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
  shellComponent: RootDocument,
  component: AppLayout,
});

/** Pages that stand on their own, with no app around them. */
const BARE = new Set(["/", "/welcome"]);

function AppLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (BARE.has(pathname)) return <Outlet />;
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
        {children}
        <Toaster />
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
        />
        <Scripts />
      </body>
    </html>
  );
}
