import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wifi, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Device } from "@shared/schema";

const STATUS_FILTERS: { label: string; value: "all" | "new" | "approved" | "monitoring" | "quarantined" | "blocked" }[] = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Approved", value: "approved" },
  { label: "Learning", value: "monitoring" },
  { label: "Quarantined", value: "quarantined" },
  { label: "Blocked", value: "blocked" },
];

export default function AllDevicesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");

  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const filteredDevices =
    devices
      ?.filter((device) => {
        if (statusFilter === "all") return true;
        return device.status === statusFilter;
      })
      .filter((device) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          device.name.toLowerCase().includes(q) ||
          device.ipAddress.toLowerCase().includes(q) ||
          device.macAddress.toLowerCase().includes(q)
        );
      }) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">All Devices</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and search across all devices, including identified, learning, and quarantined endpoints.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Devices Overview</CardTitle>
                <CardDescription>
                  {devices?.length || 0} device{(devices?.length || 0) !== 1 ? "s" : ""} discovered on the network
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 w-full sm:w-auto">
              <div className="relative flex-1">
                <Input
                  placeholder="Search by name, IP, or MAC..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-3"
                />
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap">
                    <Filter className="mr-2 h-4 w-4" />
                    Filters
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Filter devices</DialogTitle>
                    <DialogDescription>
                      Narrow down the device list by lifecycle status.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Status
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_FILTERS.map((filter) => (
                        <Button
                          key={filter.value}
                          type="button"
                          size="sm"
                          variant={statusFilter === filter.value ? "default" : "outline"}
                          onClick={() => setStatusFilter(filter.value)}
                        >
                          {filter.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wifi className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No devices found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Try adjusting your filters or search query to see more results.
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
                    <TableHead>Status</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Traffic (pps)</TableHead>
                    <TableHead>First Seen</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDevices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell className="font-medium">{device.name}</TableCell>
                      <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                      <TableCell className="font-mono text-sm">{device.macAddress}</TableCell>
                      <TableCell>
                        <StatusBadge status={device.status as any} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.groupId ? `Group #${device.groupId}` : "Unassigned"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {device.trafficRate} pps
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(device.firstSeen).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(device.lastSeen).toLocaleString()}
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


