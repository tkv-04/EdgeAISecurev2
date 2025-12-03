import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Wifi,
  Clock,
  AlertTriangle,
  ShieldOff,
  ChevronRight,
  Activity,
} from "lucide-react";
import { SummaryCard } from "@/components/summary-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { Device, DashboardStats, TrafficDataPoint } from "@shared/schema";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: devices, isLoading: devicesLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const { data: trafficData, isLoading: trafficLoading } = useQuery<TrafficDataPoint[]>({
    queryKey: ["/api/traffic"],
  });

  const formatTrafficData = () => {
    if (!trafficData || !devices) return [];

    const timeGroups: Record<string, Record<string, number>> = {};
    
    trafficData.forEach((point) => {
      const time = new Date(point.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      
      if (!timeGroups[time]) {
        timeGroups[time] = {};
      }
      
      const device = devices.find((d) => d.id === point.deviceId);
      const deviceName = device?.name || point.deviceId;
      timeGroups[time][deviceName] = point.packetsPerSecond;
    });

    return Object.entries(timeGroups).map(([time, values]) => ({
      time,
      ...values,
    }));
  };

  const chartData = formatTrafficData();
  const deviceNames = devices?.slice(0, 4).map((d) => d.name) || [];
  const chartColors = ["hsl(217, 91%, 55%)", "hsl(142, 76%, 45%)", "hsl(45, 93%, 50%)", "hsl(27, 87%, 55%)"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time overview of your IoT network security
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-9 w-16" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <SummaryCard
              title="Total Devices"
              value={stats?.totalDevices || 0}
              icon={Wifi}
              variant="default"
            />
            <SummaryCard
              title="Pending Approvals"
              value={stats?.pendingApprovals || 0}
              icon={Clock}
              variant="warning"
            />
            <SummaryCard
              title="Active Alerts"
              value={stats?.activeAlerts || 0}
              icon={AlertTriangle}
              variant="danger"
            />
            <SummaryCard
              title="Quarantined"
              value={stats?.quarantinedDevices || 0}
              icon={ShieldOff}
              variant="danger"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">Network Traffic per Device</CardTitle>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/monitoring" data-testid="link-view-monitoring">
              View Details
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {trafficLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    label={{
                      value: "Packets/sec",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 12, fill: "hsl(var(--muted-foreground))" },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  {deviceNames.map((name, index) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={chartColors[index % chartColors.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">All Devices</CardTitle>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/devices" data-testid="link-view-devices">
              View All
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {devicesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device Name</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices?.slice(0, 5).map((device) => (
                    <TableRow
                      key={device.id}
                      className="hover-elevate"
                      data-testid={`row-device-${device.id}`}
                    >
                      <TableCell className="font-medium">{device.name}</TableCell>
                      <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                      <TableCell>
                        <StatusBadge status={device.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(device.lastSeen).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/monitoring?device=${device.id}`} data-testid={`link-view-device-${device.id}`}>
                            View
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Link>
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
    </div>
  );
}
