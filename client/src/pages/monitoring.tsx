import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Activity, ArrowDown, ArrowUp, Wifi, Clock, Info, Shield
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

interface Device {
  id: number;
  name: string;
  ipAddress: string;
  macAddress: string;
  status: string;
  lastSeen: string;
}

interface SuricataStats {
  uptime: number;
  packetsTotal: number;
  alertsTotal: number;
  flowsTotal: number;
}

interface SuricataStatus {
  running: boolean;
  evePath: string;
}

interface DeviceTraffic {
  ipAddress: string;
  bytesIn: number;
  bytesOut: number;
  flowCount: number;
  protocolDistribution: Record<string, number>;
  recentFlows: Array<{
    timestamp: string;
    protocol: string;
    destIp: string;
    bytes: number;
  }>;
  lastUpdated: string;
}

const PROTOCOL_COLORS: Record<string, string> = {
  tcp: "#ef4444",
  http: "#3b82f6",
  tls: "#22c55e",
  mqtt: "#f59e0b",
  udp: "#8b5cf6",
  dns: "#ec4899",
  ssh: "#14b8a6",
  quic: "#6366f1",
  ntp: "#84cc16",
  dhcp: "#f97316",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function MonitoringPage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);

  // Fetch approved devices
  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
    select: (data) => data.filter((d) => 
      ["approved", "active", "monitoring", "learning"].includes(d.status)
    ),
  });

  // Fetch Suricata status (auto-refresh)
  const { data: suricataStatus } = useQuery<SuricataStatus>({
    queryKey: ["/api/suricata/status"],
    refetchInterval: 5000,
  });

  // Fetch Suricata stats (auto-refresh)
  const { data: stats } = useQuery<SuricataStats>({
    queryKey: ["/api/suricata/stats"],
    refetchInterval: 3000,
  });

  // Fetch all device traffic from Suricata (auto-refresh)
  const { data: allTraffic = [] } = useQuery<DeviceTraffic[]>({
    queryKey: ["/api/suricata/traffic"],
    refetchInterval: 2000,
  });

  // Auto-select first device
  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, selectedDeviceId]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  
  // Get traffic for selected device
  const deviceTraffic = selectedDevice 
    ? allTraffic.find((t) => t.ipAddress === selectedDevice.ipAddress)
    : null;

  // Prepare protocol distribution data for pie chart
  const protocolData = deviceTraffic?.protocolDistribution 
    ? Object.entries(deviceTraffic.protocolDistribution).map(([name, value]) => ({
        name: name.toUpperCase(),
        value,
        color: PROTOCOL_COLORS[name.toLowerCase()] || "#6b7280",
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header with Suricata Status */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Monitoring & Data Collection</h1>
          <p className="text-muted-foreground">
            Real-time traffic analysis powered by Suricata IDS
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Badge variant={suricataStatus?.running ? "default" : "secondary"} className="gap-2">
            <Shield className="h-3 w-3" />
            {suricataStatus?.running ? "Suricata Active" : "Suricata Offline"}
          </Badge>
          
          {/* Device selector */}
          <Select
            value={selectedDeviceId?.toString() || ""}
            onValueChange={(value) => setSelectedDeviceId(parseInt(value))}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a device" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id.toString()}>
                  {device.name} ({device.ipAddress})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Global Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Suricata Uptime</p>
          <p className="text-2xl font-bold">{Math.floor((stats?.uptime || 0) / 60)}m</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Packets</p>
          <p className="text-2xl font-bold">{(stats?.packetsTotal || 0).toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Flows</p>
          <p className="text-2xl font-bold">{(stats?.flowsTotal || 0).toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">IDS Alerts</p>
          <p className="text-2xl font-bold text-red-500">{stats?.alertsTotal || 0}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Traffic Metrics */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Traffic Metrics</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border bg-card">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <ArrowDown className="h-3 w-3 text-blue-500" /> Bytes In
                </p>
                <p className="text-2xl font-bold">
                  {formatBytes(deviceTraffic?.bytesIn || 0)}
                </p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <ArrowUp className="h-3 w-3 text-green-500" /> Bytes Out
                </p>
                <p className="text-2xl font-bold">
                  {formatBytes(deviceTraffic?.bytesOut || 0)}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-lg border bg-card">
              <p className="text-sm text-muted-foreground">Total Flows</p>
              <p className="text-2xl font-bold">{deviceTraffic?.flowCount || 0}</p>
            </div>

            {/* Device Info */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Info className="h-4 w-4" />
                Device Information
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IP Address</span>
                  <span className="font-mono">{selectedDevice?.ipAddress || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MAC Address</span>
                  <span className="font-mono text-xs">{selectedDevice?.macAddress || "-"}</span>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-muted-foreground">Last Updated</span>
                  <span>{deviceTraffic?.lastUpdated ? new Date(deviceTraffic.lastUpdated).toLocaleString() : "-"}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Protocol Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Protocol Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {protocolData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={protocolData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {protocolData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                {suricataStatus?.running 
                  ? "Waiting for traffic data..." 
                  : "Suricata not running"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Flows */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Recent Flows</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium">Timestamp</th>
                  <th className="text-left p-2 font-medium">Protocol</th>
                  <th className="text-left p-2 font-medium">Destination</th>
                  <th className="text-left p-2 font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {deviceTraffic?.recentFlows && deviceTraffic.recentFlows.length > 0 ? (
                  [...deviceTraffic.recentFlows].reverse().slice(0, 20).map((flow, idx) => (
                    <tr key={idx} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono text-xs">
                        {new Date(flow.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="p-2">
                        <Badge 
                          variant="outline" 
                          style={{ 
                            borderColor: PROTOCOL_COLORS[flow.protocol.toLowerCase()] || "#6b7280",
                            color: PROTOCOL_COLORS[flow.protocol.toLowerCase()] || "#6b7280",
                          }}
                        >
                          {flow.protocol.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-2 font-mono">{flow.destIp}</td>
                      <td className="p-2">{formatBytes(flow.bytes)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                      {suricataStatus?.running 
                        ? "No flows captured yet for this device" 
                        : "Suricata not running - traffic monitoring inactive"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
