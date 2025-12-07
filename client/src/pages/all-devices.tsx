import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wifi, Filter, Trash2, Ban } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [blockConfirmationText, setBlockConfirmationText] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const blockDeviceMutation = useMutation({
    mutationFn: async (deviceId: number) => {
      await apiRequest("POST", `/api/devices/${deviceId}/block`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Device Blocked",
        description: `${selectedDevice?.name} has been blocked from the network.`,
      });
      setSelectedDevice(null);
      setBlockConfirmationText("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to block device. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async ({ deviceId, deviceName }: { deviceId: number; deviceName: string }) => {
      const response = await fetch(`/api/devices/${deviceId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete device");
      }
      return { success: true, deviceName };
    },
    onSuccess: async (data) => {
      // Invalidate and refetch queries to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      await queryClient.refetchQueries({ queryKey: ["/api/devices"] });
      toast({
        title: "Device removed",
        description: `${data.deviceName} has been successfully removed from the network.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove device",
        variant: "destructive",
      });
    },
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
                    <TableHead className="text-right">Actions</TableHead>
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
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {device.status !== "blocked" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setSelectedDevice(device);
                                setBlockConfirmationText("");
                              }}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={deleteDeviceMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Device</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove <strong>{device.name}</strong> from the network?
                                  This action cannot be undone and all associated data will be permanently deleted.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteDeviceMutation.mutate({ deviceId: device.id, deviceName: device.name })}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  disabled={deleteDeviceMutation.isPending}
                                >
                                  {deleteDeviceMutation.isPending ? "Removing..." : "Remove Device"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog 
        open={!!selectedDevice && selectedDevice.status !== "blocked"} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDevice(null);
            setBlockConfirmationText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block Device</AlertDialogTitle>
            <AlertDialogDescription>
              This will block <strong>{selectedDevice?.name}</strong> from the network.
              The device will not be able to communicate and will be marked as blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">
              Type <strong>&quot;block&quot;</strong> to confirm:
            </label>
            <Input
              value={blockConfirmationText}
              onChange={(e) => setBlockConfirmationText(e.target.value)}
              placeholder="Type 'block' to confirm"
              className="mt-2"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setBlockConfirmationText("");
              setSelectedDevice(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedDevice) {
                  blockDeviceMutation.mutate(selectedDevice.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={blockConfirmationText.toLowerCase() !== "block" || blockDeviceMutation.isPending}
            >
              {blockDeviceMutation.isPending ? "Blocking..." : "Block Device"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


