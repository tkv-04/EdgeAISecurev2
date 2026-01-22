import { useQuery, useMutation } from "@tanstack/react-query";
import { BookOpen, Wifi, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Device } from "@shared/schema";

// Format bytes to human readable (B/s, KB/s, MB/s)
function formatBytesPerSec(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B/s";
  if (bytes < 1024) return `${bytes.toFixed(0)} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
}

export default function BaselineLearningPage() {
  const { toast } = useToast();
  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const baselineDevices = devices?.filter((d) => d.status === "monitoring") || [];
  const approvedDevices = devices?.filter((d) => d.status === "approved") || [];

  const relearnMutation = useMutation({
    mutationFn: async (deviceId: number) => {
      await apiRequest("POST", `/api/devices/${deviceId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Baseline Learning Restarted",
        description: "Baseline learning has been restarted for the selected device.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to restart baseline learning. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Baseline Learning</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor devices currently undergoing baseline behavior learning
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Devices Learning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{baselineDevices.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Currently in learning phase</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Approved Devices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{approvedDevices.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Completed baseline learning</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Learning Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {approvedDevices.length + baselineDevices.length === 0
                ? "0%"
                : Math.round(
                    (approvedDevices.length / (approvedDevices.length + baselineDevices.length)) *
                      100
                  ) + "%"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Devices with baseline complete</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">Devices in Baseline Learning Phase</CardTitle>
              <CardDescription>
                {baselineDevices.length} device{baselineDevices.length !== 1 ? "s" : ""} actively
                learning normal behavior patterns
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {baselineDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wifi className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No devices in learning phase</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Approve devices from Device Identification to begin baseline learning
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device Name</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Avg Traffic</TableHead>
                    <TableHead>First Seen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baselineDevices.map((device) => (
                    <TableRow key={device.id} data-testid={`row-baseline-${device.id}`}>
                      <TableCell className="font-medium">{device.name}</TableCell>
                      <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                      <TableCell className="font-mono text-sm">{device.macAddress}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{formatBytesPerSec(device.avgTrafficRate)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(device.firstSeen).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={device.status as any} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => relearnMutation.mutate(device.id)}
                          disabled={relearnMutation.isPending}
                          data-testid={`button-relearn-baseline-${device.id}`}
                        >
                          Restart Learning
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">Completed Baseline Learning</CardTitle>
              <CardDescription>
                {approvedDevices.length} device{approvedDevices.length !== 1 ? "s" : ""} with
                baseline behavior established
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {approvedDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wifi className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No completed devices</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Devices will appear here once baseline learning is complete
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device Name</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Baseline Traffic</TableHead>
                    <TableHead>Current Traffic</TableHead>
                    <TableHead>Variance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedDevices.map((device) => {
                    const variance = device.trafficRate - device.avgTrafficRate;
                    const variancePercent =
                      device.avgTrafficRate > 0
                        ? Math.round((Math.abs(variance) / device.avgTrafficRate) * 100)
                        : 0;

                    return (
                      <TableRow key={device.id} data-testid={`row-approved-${device.id}`}>
                        <TableCell className="font-medium">{device.name}</TableCell>
                        <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                        <TableCell>
                          <span className="text-sm">{formatBytesPerSec(device.avgTrafficRate)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{formatBytesPerSec(device.trafficRate)}</span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              variancePercent > 50
                                ? "destructive"
                                : variancePercent > 25
                                  ? "secondary"
                                  : "default"
                            }
                          >
                            {variancePercent}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={device.status as any} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => relearnMutation.mutate(device.id)}
                            disabled={relearnMutation.isPending}
                            data-testid={`button-relearn-approved-${device.id}`}
                          >
                            Relearn Traffic
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
