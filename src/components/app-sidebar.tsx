import { Link, useLoaderData, useRouterState } from "@tanstack/react-router";
import { Bot, Inbox, LogOut, Plug, Server, Settings, Workflow } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LoopableMark } from "@/components/brand";
import { DispatcherStatus } from "@/components/dispatcher-status";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type NavItem = {
  label: string;
  to?: string;
  icon: typeof Inbox;
  soon?: boolean;
};

const WORK: NavItem[] = [
  { label: "Inbox", to: "/inbox", icon: Inbox },
  { label: "Loops", to: "/loops", icon: Workflow },
];

const SETUP: NavItem[] = [
  { label: "Connectors", to: "/connectors", icon: Plug },
  { label: "Agents", to: "/agents", icon: Bot },
  { label: "Runners", to: "/runners", icon: Server },
  { label: "Settings", icon: Settings, soon: true },
];

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.label}>
              {item.to ? (
                <SidebarMenuButton
                  isActive={pathname.startsWith(item.to)}
                  tooltip={item.label}
                  render={<Link to={item.to} />}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  disabled
                  tooltip={`${item.label} (soon)`}
                  className="cursor-default opacity-60"
                >
                  <item.icon />
                  <span>{item.label}</span>
                  <Badge variant="outline" className="ml-auto">
                    Soon
                  </Badge>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Who is signed in, and the way out. Absent on a local install, where nobody signs in. */
function SignedIn() {
  const { viewer } = useLoaderData({ from: "__root__" });
  if (!viewer) return null;
  const { user } = viewer;
  return (
    <div className="flex items-center gap-2 border-t px-1 pt-2 group-data-[collapsible=icon]:hidden">
      <Avatar className="size-6">
        <AvatarImage src={user.avatarUrl ?? undefined} alt={user.login} />
        <AvatarFallback>{user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{user.name ?? user.login}</span>
      <form method="post" action="/api/auth/signout">
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

export function AppSidebar() {
  return (
    // Collapsing to icons rather than off screen, so the toggle in the header
    // is still there to toggle back with.
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <Link
            to="/connectors"
            className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:hidden"
          >
            {/* Its own mark, not the icon the Loops item uses: a logo that is
                also a menu item reads as a fourth menu item. */}
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <LoopableMark className="size-4.5" />
            </span>
            <span className="truncate font-medium">Loopable</span>
          </Link>
          <SidebarTrigger className="shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Work" items={WORK} />
        <NavGroup label="Setup" items={SETUP} />
      </SidebarContent>
      <SidebarFooter>
        {/* The dispatcher is what makes every page true, so it is reported once
            here rather than repeated on the pages that happen to care. */}
        <DispatcherStatus />
        <SignedIn />
      </SidebarFooter>
    </Sidebar>
  );
}
