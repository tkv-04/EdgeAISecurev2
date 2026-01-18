import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Shield,
  Radio,
  AlertTriangle,
  Lock,
  FileText,
  Settings,
  LogOut,
  Wifi,
  BookOpen,
  ListChecks,
  Ban,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const mainNavItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Device Identification",
    url: "/devices",
    icon: Wifi,
  },
  {
    title: "All Devices",
    url: "/all-devices",
    icon: ListChecks,
  },
  {
    title: "Baseline Learning",
    url: "/baseline-learning",
    icon: BookOpen,
  },
  {
    title: "Monitoring",
    url: "/monitoring",
    icon: Radio,
  },
  {
    title: "Anomaly Alerts",
    url: "/alerts",
    icon: AlertTriangle,
  },
  {
    title: "Suricata IDS",
    url: "/suricata-alerts",
    icon: Shield,
  },
  {
    title: "Quarantine",
    url: "/quarantine",
    icon: Lock,
  },
  {
    title: "Blocked Devices",
    url: "/blocked-devices",
    icon: Ban,
  },
  {
    title: "Logs & Audit",
    url: "/logs",
    icon: FileText,
  },
];

const settingsNavItems = [
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-3" data-testid="link-logo">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Edge AI IoT</span>
            <span className="text-xs text-muted-foreground">Security Center</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link
                        href={item.url}
                        className={cn(
                          isActive && "bg-sidebar-accent font-medium"
                        )}
                        data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNavItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link
                        href={item.url}
                        className={cn(
                          isActive && "bg-sidebar-accent font-medium"
                        )}
                        data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {user?.name?.charAt(0).toUpperCase() || "A"}
          </div>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium">{user?.name || "Admin"}</span>
            <span className="text-xs text-muted-foreground">{user?.email || "admin@iot.local"}</span>
          </div>
          <button
            onClick={logout}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover-elevate"
            aria-label="Logout"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
