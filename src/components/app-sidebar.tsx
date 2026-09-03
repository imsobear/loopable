import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, Inbox, Plug, Settings, Workflow } from "lucide-react";
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
} from "@/components/ui/sidebar";

type NavItem = {
  label: string;
  to?: string;
  icon: typeof Inbox;
  soon?: boolean;
};

const LOOP: NavItem[] = [
  { label: "Inbox", to: "/inbox", icon: Inbox },
  { label: "Rules", to: "/rules", icon: Workflow },
];

const SETUP: NavItem[] = [
  { label: "Connectors", to: "/connectors", icon: Plug },
  { label: "Agents", to: "/agents", icon: Bot },
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
                  render={<Link to={item.to} />}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton disabled className="cursor-default opacity-60">
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

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <Link to="/connectors" className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="size-4" />
          </span>
          <span className="font-medium">Loopable</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Loop" items={LOOP} />
        <NavGroup label="Setup" items={SETUP} />
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          Runs on this machine, with your own agents and your own credentials.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
