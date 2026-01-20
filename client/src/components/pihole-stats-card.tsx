import { useQuery } from "@tanstack/react-query";
import { Shield, Globe, Ban, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface PiholeStatus {
  installed: boolean;
  running: boolean;
  version: string;
}

interface PiholeStats {
  status: "enabled" | "disabled" | "unknown";
  totalQueries: number;
  blockedQueries: number;
  percentBlocked: number;
  domainsOnBlocklist: number;
  privacyLevel: number;
}

export function PiholeStatsCard() {
  const { data: status, isLoading: statusLoading } = useQuery<PiholeStatus>({
    queryKey: ["/api/pihole/status"],
    refetchInterval: 30000,
  });

  const { data: stats, isLoading: statsLoading, refetch } = useQuery<PiholeStats>({
    queryKey: ["/api/pihole/stats"],
    refetchInterval: 30000,
  });

  const isLoading = statusLoading || statsLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isRunning = status?.running || false;
  const isEnabled = stats?.status === "enabled";

  return (
    <Card className={isRunning ? "" : "border-orange-500/50"}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${isRunning ? "bg-green-500/10" : "bg-orange-500/10"}`}>
              <Shield className={`h-5 w-5 ${isRunning ? "text-green-500" : "text-orange-500"}`} />
            </div>
            <div>
              <CardTitle className="text-base">Pi-hole DNS</CardTitle>
              <CardDescription className="text-xs">
                {status?.installed ? `v${status.version}` : "Not installed"}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isRunning && isEnabled ? "default" : "secondary"} className={isRunning && isEnabled ? "bg-green-500" : ""}>
              {!status?.installed ? "Not Installed" : !isRunning ? "Stopped" : isEnabled ? "Active" : "Disabled"}
            </Badge>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status?.installed ? (
          <p className="text-sm text-muted-foreground">Pi-hole is not installed on this system.</p>
        ) : !isRunning ? (
          <div className="flex items-center gap-2 text-orange-500">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm">Pi-hole service is not running</p>
          </div>
        ) : (
          <>
            {/* Query Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Queries</p>
                <p className="text-xl font-bold">{(stats?.totalQueries || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Blocked Queries</p>
                <p className="text-xl font-bold text-red-500">{(stats?.blockedQueries || 0).toLocaleString()}</p>
              </div>
            </div>

            {/* Block Percentage */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-muted-foreground">Queries Blocked</span>
                <span className="text-xs font-medium">{(stats?.percentBlocked || 0).toFixed(1)}%</span>
              </div>
              <Progress value={stats?.percentBlocked || 0} className="h-2" />
            </div>

            {/* Domains on Blocklist */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Ban className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Domains on Blocklist</span>
              </div>
              <span className="font-medium">{(stats?.domainsOnBlocklist || 0).toLocaleString()}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
