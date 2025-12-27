import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Wifi,
  Plus,
  Check,
  X,
  Search,
  RefreshCw,
  Shield,
  AlertTriangle,
  Radar,
  Pencil,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Device } from "@shared/schema";

export default function DevicesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | "block" | "unblock" | "simulate-attack" | "rename" | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const newDevices = devices?.filter((d) => d.status === "new") || [];
  const filteredDevices = newDevices.filter(
    (device) =>
      device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      device.ipAddress.includes(searchQuery) ||
      device.macAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const approveMutation = useMutation({
    mutationFn: async (deviceId: number) => {
      await apiRequest("POST", `/api/devices/${deviceId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Device Approved",
        description: `${selectedDevice?.name} has been approved and baseline learning started.`,
      });
      setSelectedDevice(null);
      setActionType(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve device. Please try again.",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (deviceId: number) => {
      await apiRequest("POST", `/api/devices/${deviceId}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Device Rejected",
        description: `${selectedDevice?.name} has been blocked from the network.`,
      });
      setSelectedDevice(null);
      setActionType(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reject device. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Network scan mutation
  const scanMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/devices/scan", { deep: false });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Network Scan Complete",
        description: `Found ${data.scanned} device(s) on network. ${data.newDevices} new device(s) added.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to scan network. Please try again.",
        variant: "destructive",
      });
    },
  });

  const simulateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/devices/simulate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "New Device Discovered",
        description: "A simulated device has been added to the pending list.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to simulate device. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAction = () => {
    if (!selectedDevice || !actionType) return;
    
    if (actionType === "approve") {
      approveMutation.mutate(selectedDevice.id);
    } else if (actionType === "rename") {
      renameMutation.mutate({ id: selectedDevice.id, name: renameValue });
    } else {
      rejectMutation.mutate(selectedDevice.id);
    }
  };

  // Rename mutation
  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      await apiRequest("PUT", `/api/devices/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({
        title: "Device Renamed",
        description: `Device has been renamed to "${renameValue}".`,
      });
      setSelectedDevice(null);
      setActionType(null);
      setRenameValue("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to rename device. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Device Identification</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and onboard new devices discovered on your network
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            data-testid="button-scan-network"
          >
            {scanMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Radar className="mr-2 h-4 w-4" />
            )}
            Scan Network
          </Button>
          <Button
            variant="outline"
            onClick={() => simulateMutation.mutate()}
            disabled={simulateMutation.isPending}
            data-testid="button-simulate-device"
          >
            {simulateMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Simulate
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">New Devices Pending Approval</CardTitle>
                <CardDescription>
                  {newDevices.length} device{newDevices.length !== 1 ? "s" : ""} awaiting review
                </CardDescription>
              </div>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search devices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-devices"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wifi className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No pending devices</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery
                  ? "No devices match your search criteria"
                  : "All devices have been reviewed. Click 'Add Simulated Device' to test the workflow."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device Name / ID</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>First Seen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDevices.map((device) => (
                    <TableRow
                      key={device.id}
                      className="hover-elevate"
                      data-testid={`row-device-${device.id}`}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {device.name}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => {
                              setSelectedDevice(device);
                              setRenameValue(device.name);
                              setActionType("rename");
                            }}
                            data-testid={`button-rename-${device.id}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{device.macAddress}</TableCell>
                      <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(device.firstSeen).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={device.status as any} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedDevice(device);
                              setActionType("approve");
                            }}
                            data-testid={`button-approve-${device.id}`}
                          >
                            <Check className="mr-1 h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setSelectedDevice(device);
                              setActionType("reject");
                            }}
                            data-testid={`button-reject-${device.id}`}
                          >
                            <X className="mr-1 h-4 w-4" />
                            Reject
                          </Button>
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

      <AlertDialog open={!!selectedDevice && !!actionType} onOpenChange={() => {
        setSelectedDevice(null);
        setActionType(null);
        setRenameValue("");
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionType === "approve" ? "Approve Device?" : actionType === "rename" ? "Rename Device" : "Reject Device?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {actionType === "approve" ? (
                  <>
                    This will approve <strong>{selectedDevice?.name}</strong> and begin baseline
                    learning for anomaly detection. The device will be allowed to communicate
                    on the network.
                  </>
                ) : actionType === "rename" ? (
                  <div className="space-y-3 pt-2">
                    <p>Enter a new name for this device:</p>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      placeholder="Device name"
                      autoFocus
                      data-testid="input-rename-device"
                    />
                  </div>
                ) : (
                  <>
                    This will block <strong>{selectedDevice?.name}</strong> from the network.
                    The device will not be able to communicate and will be marked as blocked.
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-action">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              className={actionType === "reject" ? "bg-destructive hover:bg-destructive/90" : ""}
              disabled={actionType === "rename" && !renameValue.trim()}
              data-testid="button-confirm-action"
            >
              {actionType === "approve" ? "Approve" : actionType === "rename" ? "Save" : "Block Device"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
