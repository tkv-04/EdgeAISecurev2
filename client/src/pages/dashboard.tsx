import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import {
  Wifi,
  Clock,
  AlertTriangle,
  ShieldOff,
  ChevronRight,
  Activity,
  Filter,
} from "lucide-react";
import { SummaryCard } from "@/components/summary-card";
import { StatusBadge } from "@/components/status-badge";
import { AIConfidenceBadge } from "@/components/ai-confidence-badge";
import { LearningProgressBadge } from "@/components/learning-progress-badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import type { Device, DashboardStats, TrafficDataPoint, DeviceStatus } from "@shared/schema";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: devices, isLoading: devicesLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
    refetchInterval: 30000,
  });

  const { data: trafficData, isLoading: trafficLoading } = useQuery<TrafficDataPoint[]>({
    queryKey: ["/api/traffic"],
    refetchInterval: 10000, // Refresh traffic data every 10 seconds
  });

  // Device selection state - default to first 4 devices
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<number>>(new Set());

  // Initialize selected devices when devices load - only approved devices
  useEffect(() => {
    if (devices && devices.length > 0 && selectedDeviceIds.size === 0) {
      // Filter to only approved devices
      const approvedStatuses = ["approved", "active", "monitoring", "learning", "anomalous"];
      const approvedDevices = devices.filter(d => approvedStatuses.includes(d.status));
      const defaultIds = new Set(approvedDevices.slice(0, 4).map(d => d.id));
      setSelectedDeviceIds(defaultIds);
    }
  }, [devices, selectedDeviceIds.size]);

  const toggleDeviceSelection = (deviceId: number) => {
    setSelectedDeviceIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(deviceId)) {
        newSet.delete(deviceId);
      } else {
        newSet.add(deviceId);
      }
      return newSet;
    });
  };

  const formatTrafficData = () => {
    if (!trafficData || !devices || selectedDeviceIds.size === 0) {
      console.log("[Dashboard] No data:", { trafficData: !!trafficData, devices: !!devices, selectedSize: selectedDeviceIds.size });
      return [];
    }

    // Get selected devices
    const selectedDevices = devices.filter(d => selectedDeviceIds.has(d.id));
    console.log("[Dashboard] Selected devices:", selectedDevices.map(d => ({ id: d.id, name: d.name })));
    if (selectedDevices.length === 0) return [];

    // Filter and sort traffic data by timestamp - only last 2 hours
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
    
    const filteredData = trafficData
      .filter(point => selectedDeviceIds.has(point.deviceId))
      .filter(point => new Date(point.timestamp) >= twoHoursAgo)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    console.log("[Dashboard] Filtered traffic data (last 2h):", filteredData.length, "points for devices:", Array.from(selectedDeviceIds));
    if (filteredData.length === 0) return [];

    // Group traffic data by timestamp (rounded to nearest 5 minutes for cleaner display)
    const timeGroups: Map<number, Map<number, number[]>> = new Map();
    
    filteredData.forEach((point) => {
      const date = new Date(point.timestamp);
      // Round to nearest 5 minutes for cleaner display (in local time)
      const roundedDate = new Date(date);
      roundedDate.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0);
      
      // Use epoch milliseconds as key for proper sorting
      const timeKey = roundedDate.getTime();
      
      if (!timeGroups.has(timeKey)) {
        timeGroups.set(timeKey, new Map());
      }
      
      const deviceData = timeGroups.get(timeKey)!;
      if (!deviceData.has(point.deviceId)) {
        deviceData.set(point.deviceId, []);
      }
      // Store bytes converted to KB for display
      deviceData.get(point.deviceId)!.push(Math.round((point.bytesPerSecond || 0) / 1024));
    });

    // Convert to array format and ensure all devices have values for all time points
    const timeKeys = Array.from(timeGroups.keys()).sort((a, b) => a - b);
    const chartData = timeKeys.map(timeKey => {
      const deviceData = timeGroups.get(timeKey)!;
      // Format time using native Date (should use browser timezone)
      const time = new Date(timeKey);
      const hours = time.getHours();
      const minutes = time.getMinutes();
      const period = hours >= 12 ? "PM" : "AM";
      const hour12 = hours % 12 || 12;
      const dataPoint: Record<string, string | number> = {
        time: `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`,
      };
      
      // Add value for each selected device (average if multiple values, 0 if no data)
      selectedDevices.forEach(device => {
        const values = deviceData.get(device.id);
        if (values && values.length > 0) {
          dataPoint[device.name] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        } else {
          dataPoint[device.name] = 0;
        }
      });
      
      return dataPoint;
    });

    return chartData;
  };

  const chartData = formatTrafficData();
  console.log("[Dashboard] chartData:", chartData.slice(0, 5)); // Log first 5 entries
  const selectedDevices = devices?.filter(d => selectedDeviceIds.has(d.id)) || [];
  // Filter to only show approved devices in the device selector and charts
  const approvedStatuses = ["approved", "active", "monitoring", "learning", "anomalous"];
  const approvedDevices = devices?.filter(d => approvedStatuses.includes(d.status)) || [];
  const chartColors = ["hsl(217, 91%, 55%)", "hsl(142, 76%, 45%)", "hsl(45, 93%, 50%)", "hsl(27, 87%, 55%)", "hsl(340, 82%, 52%)", "hsl(190, 75%, 45%)", "hsl(280, 70%, 50%)", "hsl(10, 80%, 50%)"];

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
              title="Approved Devices"
              value={stats?.approvedDevices || 0}
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
          <div className="flex items-center gap-2">
            {devices && devices.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="mr-2 h-4 w-4" />
                    Select Devices ({selectedDeviceIds.size})
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm mb-3">Select devices to display</h4>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {approvedDevices.map((device: any) => (
                        <div key={device.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`device-${device.id}`}
                            checked={selectedDeviceIds.has(device.id)}
                            onCheckedChange={() => toggleDeviceSelection(device.id)}
                          />
                          <label
                            htmlFor={`device-${device.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                          >
                            {device.name}
                          </label>
                          <AIConfidenceBadge
                            confidence={device.aiConfidence || 0}
                            samples={device.aiSamples || 0}
                            hasModel={device.hasAiModel || false}
                          />
                          <LearningProgressBadge
                            isLearning={device.isLearning || false}
                            progress={device.learningProgress || 0}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/monitoring" data-testid="link-view-monitoring">
                View Details
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {trafficLoading || devicesLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {selectedDeviceIds.size === 0 
                    ? "Select devices to view traffic data" 
                    : "No traffic data available for selected devices"}
                </p>
              </div>
            </div>
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
                      value: "KB/sec",
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
                  {selectedDevices.map((device, index) => (
                    <Line
                      key={device.id}
                      type="monotone"
                      dataKey={device.name}
                      stroke={chartColors[index % chartColors.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
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
            <CardTitle className="text-lg font-semibold">Approved Devices</CardTitle>
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
                  {approvedDevices?.slice(0, 5).map((device) => (
                    <TableRow
                      key={device.id}
                      className="hover-elevate"
                      data-testid={`row-device-${device.id}`}
                    >
                      <TableCell className="font-medium">{device.name}</TableCell>
                      <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                      <TableCell>
                        <StatusBadge status={device.status as DeviceStatus} />
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
