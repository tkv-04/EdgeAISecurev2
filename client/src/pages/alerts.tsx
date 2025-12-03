import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  Bell,
  Search,
  Filter,
  RefreshCw,
  CheckCircle,
  Eye,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Alert, AlertSeverity, AlertStatus } from "@shared/schema";

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  high_traffic: "High Traffic",
  unknown_ip: "Unknown IP",
  port_scan: "Port Scan",
  protocol_violation: "Protocol Violation",
  unusual_timing: "Unusual Timing",
  data_exfiltration: "Data Exfiltration",
};

export default function AlertsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");

  const { data: alerts, isLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const filteredAlerts = alerts?.filter((alert) => {
    const matchesSearch =
      alert.deviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSeverity = severityFilter === "all" || alert.severity === severityFilter;
    const matchesStatus = statusFilter === "all" || alert.status === statusFilter;
    return matchesSearch && matchesSeverity && matchesStatus;
  }) || [];

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("POST", `/api/alerts/${alertId}/acknowledge`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Alert Acknowledged",
        description: "The alert has been marked as acknowledged.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to acknowledge alert.",
        variant: "destructive",
      });
    },
  });

  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("POST", `/api/alerts/${alertId}/resolve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Alert Resolved",
        description: "The alert has been marked as resolved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to resolve alert.",
        variant: "destructive",
      });
    },
  });

  const simulateAlert = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/alerts/simulate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Alert Generated",
        description: "A simulated anomaly alert has been created.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate alert.",
        variant: "destructive",
      });
    },
  });

  const openAlerts = alerts?.filter((a) => a.status === "open").length || 0;
  const highSeverityAlerts = alerts?.filter((a) => a.severity === "high" && a.status === "open").length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Anomaly Detection & Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and respond to security anomalies detected by Edge AI
          </p>
        </div>
        <Button
          onClick={() => simulateAlert.mutate()}
          disabled={simulateAlert.isPending}
          data-testid="button-simulate-alert"
        >
          {simulateAlert.isPending ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Bell className="mr-2 h-4 w-4" />
          )}
          Generate Simulated Alert
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className={openAlerts > 0 ? "border-status-suspicious/50" : ""}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-status-suspicious/10">
              <AlertTriangle className="h-6 w-6 text-status-suspicious" />
            </div>
            <div>
              <p className="text-2xl font-semibold font-mono">{openAlerts}</p>
              <p className="text-sm text-muted-foreground">Open Alerts</p>
            </div>
          </CardContent>
        </Card>
        <Card className={highSeverityAlerts > 0 ? "border-status-danger/50" : ""}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-status-danger/10">
              <AlertTriangle className="h-6 w-6 text-status-danger" />
            </div>
            <div>
              <p className="text-2xl font-semibold font-mono">{highSeverityAlerts}</p>
              <p className="text-sm text-muted-foreground">High Severity</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Alert History</CardTitle>
                <CardDescription>
                  {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""} found
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search alerts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-full sm:w-48"
                  data-testid="input-search-alerts"
                />
              </div>
              <div className="flex gap-2">
                <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as AlertSeverity | "all")}>
                  <SelectTrigger className="w-32" data-testid="select-severity">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as AlertStatus | "all")}>
                  <SelectTrigger className="w-36" data-testid="select-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No alerts found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery || severityFilter !== "all" || statusFilter !== "all"
                  ? "Try adjusting your filters"
                  : "Click 'Generate Simulated Alert' to test the workflow"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Anomaly Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((alert) => (
                    <TableRow
                      key={alert.id}
                      className={`hover-elevate ${
                        alert.anomalyScore >= 0.8 ? "bg-status-danger/5" : ""
                      }`}
                      data-testid={`row-alert-${alert.id}`}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(alert.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium">{alert.deviceName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ANOMALY_TYPE_LABELS[alert.anomalyType] || alert.anomalyType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={alert.severity} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={`font-mono text-sm font-medium ${
                            alert.anomalyScore >= 0.8
                              ? "text-status-danger"
                              : alert.anomalyScore >= 0.5
                              ? "text-status-suspicious"
                              : "text-muted-foreground"
                          }`}
                        >
                          {alert.anomalyScore.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={alert.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {alert.status === "open" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => acknowledgeAlert.mutate(alert.id)}
                              disabled={acknowledgeAlert.isPending}
                              data-testid={`button-acknowledge-${alert.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {(alert.status === "open" || alert.status === "acknowledged") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => resolveAlert.mutate(alert.id)}
                              disabled={resolveAlert.isPending}
                              data-testid={`button-resolve-${alert.id}`}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
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
    </div>
  );
}
