import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import {
  Radio,
  Activity,
  ArrowUp,
  ArrowDown,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import type { Device, PacketEvent } from "@shared/schema";

const PROTOCOL_COLORS: Record<string, string> = {
  HTTP: "hsl(217, 91%, 55%)",
  HTTPS: "hsl(217, 91%, 40%)",
  MQTT: "hsl(142, 76%, 45%)",
  CoAP: "hsl(45, 93%, 50%)",
  WebSocket: "hsl(27, 87%, 55%)",
  TCP: "hsl(340, 82%, 52%)",
  UDP: "hsl(280, 65%, 55%)",
  DNS: "hsl(190, 75%, 45%)",
};

export default function MonitoringPage() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const deviceIdFromUrl = urlParams.get("device");

  const [selectedDeviceId, setSelectedDeviceId] = useState<number>(0);

  const { data: devices, isLoading: devicesLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const approvedDevices = devices?.filter(
    (d) => d.status === "approved" || d.status === "monitoring"
  ) || [];

  useEffect(() => {
    const urlDeviceId = deviceIdFromUrl ? parseInt(deviceIdFromUrl) : null;
    if (urlDeviceId && approvedDevices.some((d) => d.id === urlDeviceId)) {
      setSelectedDeviceId(urlDeviceId);
    } else if (approvedDevices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(approvedDevices[0].id);
    }
  }, [deviceIdFromUrl, approvedDevices, selectedDeviceId]);

  const selectedDevice = approvedDevices.find((d) => d.id === selectedDeviceId);

  const { data: packetEvents, isLoading: packetsLoading } = useQuery<PacketEvent[]>({
    queryKey: ["/api/devices", selectedDeviceId, "packets"],
    enabled: !!selectedDeviceId,
  });

  const protocolData = selectedDevice
    ? Object.entries(selectedDevice.protocols as Record<string, number>).map(([name, value]) => ({
        name,
        value,
        color: PROTOCOL_COLORS[name] || "hsl(var(--muted))",
      }))
    : [];

  if (devicesLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (approvedDevices.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring & Data Collection</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time traffic analysis for approved devices
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Radio className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No Devices to Monitor</h3>
            <p className="text-sm text-muted-foreground mt-1 text-center max-w-md">
              Approve devices from the Device Identification page to begin monitoring their
              network traffic and behavior patterns.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring & Data Collection</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time traffic analysis for approved devices
          </p>
        </div>
        <div className="w-full sm:w-72">
          <Select value={String(selectedDeviceId)} onValueChange={(val) => setSelectedDeviceId(parseInt(val))}>
            <SelectTrigger data-testid="select-device">
              <SelectValue placeholder="Select a device" />
            </SelectTrigger>
            <SelectContent>
              {approvedDevices.map((device) => (
                <SelectItem key={device.id} value={String(device.id)}>
                  {device.name} ({device.ipAddress})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedDevice && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Traffic Metrics</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">Current Rate</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-semibold font-mono">
                        {selectedDevice.trafficRate}
                      </span>
                      <span className="text-sm text-muted-foreground">pkts/sec</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs">
                      {selectedDevice.trafficRate > selectedDevice.avgTrafficRate ? (
                        <>
                          <ArrowUp className="h-3 w-3 text-status-suspicious" />
                          <span className="text-status-suspicious">
                            {Math.round(
                              ((selectedDevice.trafficRate - selectedDevice.avgTrafficRate) /
                                selectedDevice.avgTrafficRate) *
                                100
                            )}
                            % above baseline
                          </span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="h-3 w-3 text-status-normal" />
                          <span className="text-status-normal">Within baseline</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">Baseline Average</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-semibold font-mono">
                        {selectedDevice.avgTrafficRate}
                      </span>
                      <span className="text-sm text-muted-foreground">pkts/sec</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>24-hour rolling average</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Device Information</p>
                  <div className="grid gap-2 text-sm">
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">IP Address</span>
                      <span className="font-mono">{selectedDevice.ipAddress}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">MAC Address</span>
                      <span className="font-mono">{selectedDevice.macAddress}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Last Seen</span>
                      <span className="font-mono text-xs">
                        {new Date(selectedDevice.lastSeen).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Radio className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Protocol Distribution</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={protocolData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {protocolData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.5rem",
                          fontSize: 12,
                        }}
                        formatter={(value: number) => [`${value}%`, "Usage"]}
                      />
                      <Legend
                        formatter={(value) => (
                          <span className="text-xs">{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Recent Packet Events</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {packetsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !packetEvents || packetEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Clock className="h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No recent packet events to display
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Protocol</TableHead>
                        <TableHead>Source IP</TableHead>
                        <TableHead>Destination IP</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Direction</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {packetEvents.slice(0, 10).map((event) => (
                        <TableRow key={event.id} className="hover-elevate">
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{event.protocol}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{event.sourceIp}</TableCell>
                          <TableCell className="font-mono text-sm">{event.destIp}</TableCell>
                          <TableCell className="font-mono text-sm">{event.size} B</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex items-center gap-1 text-xs ${
                                event.direction === "inbound"
                                  ? "text-status-pending"
                                  : "text-status-normal"
                              }`}
                            >
                              {event.direction === "inbound" ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUp className="h-3 w-3" />
                              )}
                              {event.direction}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
