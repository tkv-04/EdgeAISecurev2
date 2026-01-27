import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Ban,
  Unlock,
  ShieldAlert,
  Search,
  Trash2,
  RefreshCw,
} from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Device } from "@shared/schema";

export default function BlockedDevicesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [actionType, setActionType] = useState<"unblock" | "delete" | null>(null);
  const [unblockConfirmationText, setUnblockConfirmationText] = useState("");

  const { data: devices, isLoading, isFetching, refetch } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  const blockedDevices = devices?.filter((d) => d.status === "blocked") || [];
  const filteredDevices = blockedDevices.filter(
    (device) =>
      device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      device.ipAddress.includes(searchQuery) ||
      device.macAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const unblockMutation = useMutation({
    mutationFn: async (deviceId: number) => {
      await apiRequest("POST", `/api/devices/${deviceId}/unblock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Device Unblocked",
        description: `${selectedDevice?.name} has been unblocked and re-approved for baseline learning.`,
      });
      setSelectedDevice(null);
      setActionType(null);
      setUnblockConfirmationText("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to unblock device. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
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
      await queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      await queryClient.refetchQueries({ queryKey: ["/api/devices"] });
      toast({
        title: "Device removed",
        description: `${data.deviceName} has been successfully removed from the network.`,
      });
      setSelectedDevice(null);
      setActionType(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove device",
        variant: "destructive",
      });
    },
  });

  const handleAction = () => {
    if (!selectedDevice || !actionType) return;
    
    if (actionType === "unblock") {
      unblockMutation.mutate(selectedDevice.id);
    } else {
      deleteMutation.mutate({ deviceId: selectedDevice.id, deviceName: selectedDevice.name });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Blocked Devices</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage devices that have been blocked from the network
        </p>
      </div>

      <Alert className="border-status-danger/30 bg-status-danger/5">
        <ShieldAlert className="h-4 w-4 text-status-danger" />
        <AlertTitle className="text-status-danger">Blocked Devices</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          These devices have been blocked from accessing the network. You can unblock them to allow
          reconnection or permanently remove them from the system.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Blocked Devices</CardTitle>
                <CardDescription>
                  {blockedDevices.length} device{blockedDevices.length !== 1 ? "s" : ""} blocked from the network
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search devices..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-blocked"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                {isFetching ? 'Refreshing...' : 'Refresh'}
              </Button>
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
              <Ban className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">
                {searchQuery ? "No matching devices" : "No Blocked Devices"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                {searchQuery
                  ? "No blocked devices match your search criteria"
                  : "All devices are currently allowed on the network. Blocked devices will appear here."}
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
                    <TableHead>First Seen</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDevices.map((device) => (
                    <TableRow
                      key={device.id}
                      className="hover-elevate"
                      data-testid={`row-blocked-${device.id}`}
                    >
                      <TableCell className="font-medium">{device.name}</TableCell>
                      <TableCell className="font-mono text-sm">{device.ipAddress}</TableCell>
                      <TableCell className="font-mono text-sm">{device.macAddress}</TableCell>
                      <TableCell>
                        <StatusBadge status={device.status as any} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(device.firstSeen).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(device.lastSeen).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedDevice(device);
                              setActionType("unblock");
                              setUnblockConfirmationText("");
                            }}
                            disabled={unblockMutation.isPending}
                            data-testid={`button-unblock-${device.id}`}
                          >
                            <Unlock className="mr-1 h-4 w-4" />
                            Unblock
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Device</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to permanently remove <strong>{device.name}</strong> from the network?
                                  This action cannot be undone and all associated data will be permanently deleted.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => {
                                    deleteMutation.mutate({ deviceId: device.id, deviceName: device.name });
                                  }}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  disabled={deleteMutation.isPending}
                                >
                                  {deleteMutation.isPending ? "Removing..." : "Remove Device"}
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
        open={!!selectedDevice && actionType === "unblock"} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDevice(null);
            setActionType(null);
            setUnblockConfirmationText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock Device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unblock <strong>{selectedDevice?.name}</strong> and allow it to reconnect to the network.
              The device will be re-approved and baseline learning will begin automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">
              Type <strong>&quot;unblock&quot;</strong> to confirm:
            </label>
            <Input
              value={unblockConfirmationText}
              onChange={(e) => setUnblockConfirmationText(e.target.value)}
              placeholder="Type 'unblock' to confirm"
              className="mt-2"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                setUnblockConfirmationText("");
                setSelectedDevice(null);
                setActionType(null);
              }}
              data-testid="button-cancel-action"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              data-testid="button-confirm-action"
              disabled={unblockConfirmationText.toLowerCase() !== "unblock" || unblockMutation.isPending}
            >
              {unblockMutation.isPending ? "Unblocking..." : "Unblock Device"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

