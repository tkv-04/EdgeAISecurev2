import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Lock,
  Unlock,
  Ban,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { QuarantineRecord } from "@shared/schema";

export default function QuarantinePage() {
  const { toast } = useToast();
  const [selectedRecord, setSelectedRecord] = useState<QuarantineRecord | null>(null);
  const [actionType, setActionType] = useState<"release" | "block" | null>(null);

  const { data: quarantineRecords, isLoading } = useQuery<QuarantineRecord[]>({
    queryKey: ["/api/quarantine"],
  });

  const releaseMutation = useMutation({
    mutationFn: async (recordId: string) => {
      await apiRequest("POST", `/api/quarantine/${recordId}/release`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quarantine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Device Released",
        description: `${selectedRecord?.deviceName} has been released from quarantine.`,
      });
      setSelectedRecord(null);
      setActionType(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to release device.",
        variant: "destructive",
      });
    },
  });

  const blockMutation = useMutation({
    mutationFn: async (recordId: string) => {
      await apiRequest("POST", `/api/quarantine/${recordId}/block`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quarantine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Device Blocked",
        description: `${selectedRecord?.deviceName} has been permanently blocked.`,
      });
      setSelectedRecord(null);
      setActionType(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to block device.",
        variant: "destructive",
      });
    },
  });

  const handleAction = () => {
    if (!selectedRecord || !actionType) return;
    
    if (actionType === "release") {
      releaseMutation.mutate(selectedRecord.id);
    } else {
      blockMutation.mutate(selectedRecord.id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Quarantine Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage devices that have been isolated due to security threats
        </p>
      </div>

      <Alert className="border-status-danger/30 bg-status-danger/5">
        <ShieldAlert className="h-4 w-4 text-status-danger" />
        <AlertTitle className="text-status-danger">Automatic Quarantine</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Devices are automatically quarantined when they trigger high-severity anomalies.
          Review each device carefully before releasing or permanently blocking it.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">Quarantined Devices</CardTitle>
              <CardDescription>
                {quarantineRecords?.length || 0} device{(quarantineRecords?.length || 0) !== 1 ? "s" : ""} in quarantine
              </CardDescription>
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
          ) : !quarantineRecords || quarantineRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Lock className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No Quarantined Devices</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                All devices are operating normally. Devices will appear here when they
                trigger high-severity security anomalies.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device Name</TableHead>
                    <TableHead>Reason for Quarantine</TableHead>
                    <TableHead>Time Quarantined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quarantineRecords.map((record) => (
                    <TableRow
                      key={record.id}
                      className="hover-elevate"
                      data-testid={`row-quarantine-${record.id}`}
                    >
                      <TableCell className="font-medium">{record.deviceName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {record.reason}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(record.timeQuarantined).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedRecord(record);
                              setActionType("release");
                            }}
                            data-testid={`button-release-${record.id}`}
                          >
                            <Unlock className="mr-1 h-4 w-4" />
                            Release
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setSelectedRecord(record);
                              setActionType("block");
                            }}
                            data-testid={`button-block-${record.id}`}
                          >
                            <Ban className="mr-1 h-4 w-4" />
                            Block Permanently
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

      <AlertDialog open={!!selectedRecord && !!actionType} onOpenChange={() => {
        setSelectedRecord(null);
        setActionType(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionType === "release" ? "Release Device?" : "Block Device Permanently?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === "release" ? (
                <>
                  This will release <strong>{selectedRecord?.deviceName}</strong> from quarantine
                  and allow it to resume normal network communication. Make sure the security
                  threat has been resolved.
                </>
              ) : (
                <>
                  This will permanently block <strong>{selectedRecord?.deviceName}</strong> from
                  the network. The device will not be able to reconnect and will need to be
                  manually removed from the blocklist to rejoin.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-action">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              className={actionType === "block" ? "bg-destructive hover:bg-destructive/90" : ""}
              data-testid="button-confirm-action"
            >
              {actionType === "release" ? "Release Device" : "Block Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
