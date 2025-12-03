import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { SettingsProvider } from "@/lib/settings-context";

import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import DevicesPage from "@/pages/devices";
import AllDevicesPage from "@/pages/all-devices";
import BaselineLearningPage from "@/pages/baseline-learning";
import MonitoringPage from "@/pages/monitoring";
import AlertsPage from "@/pages/alerts";
import QuarantinePage from "@/pages/quarantine";
import LogsPage from "@/pages/logs";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <Component />;
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex h-14 items-center justify-between gap-4 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  const { isAuthenticated } = useAuth();

  return (
    <Switch>
      <Route path="/login">
        {isAuthenticated ? <Redirect to="/dashboard" /> : <LoginPage />}
      </Route>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/dashboard">
        <AuthenticatedLayout>
          <ProtectedRoute component={DashboardPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/devices">
        <AuthenticatedLayout>
          <ProtectedRoute component={DevicesPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/all-devices">
        <AuthenticatedLayout>
          <ProtectedRoute component={AllDevicesPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/baseline-learning">
        <AuthenticatedLayout>
          <ProtectedRoute component={BaselineLearningPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/monitoring">
        <AuthenticatedLayout>
          <ProtectedRoute component={MonitoringPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/alerts">
        <AuthenticatedLayout>
          <ProtectedRoute component={AlertsPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/quarantine">
        <AuthenticatedLayout>
          <ProtectedRoute component={QuarantinePage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/logs">
        <AuthenticatedLayout>
          <ProtectedRoute component={LogsPage} />
        </AuthenticatedLayout>
      </Route>
      <Route path="/settings">
        <AuthenticatedLayout>
          <ProtectedRoute component={SettingsPage} />
        </AuthenticatedLayout>
      </Route>
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsProvider>
          <AuthProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </AuthProvider>
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
