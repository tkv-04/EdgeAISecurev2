import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  FileText,
  Search,
  Filter,
  Calendar,
  Download,
  User,
  Bot,
} from "lucide-react";
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
import type { LogEntry, LogEventType } from "@shared/schema";

const EVENT_TYPE_LABELS: Record<LogEventType, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  device_approved: { label: "Device Approved", variant: "default" },
  device_rejected: { label: "Device Rejected", variant: "destructive" },
  device_discovered: { label: "Device Discovered", variant: "outline" },
  anomaly_detected: { label: "Anomaly Detected", variant: "destructive" },
  device_quarantined: { label: "Device Quarantined", variant: "destructive" },
  device_released: { label: "Device Released", variant: "default" },
  device_blocked: { label: "Device Blocked", variant: "destructive" },
  login: { label: "Login", variant: "secondary" },
  logout: { label: "Logout", variant: "secondary" },
  settings_changed: { label: "Settings Changed", variant: "outline" },
};

const ALL_EVENT_TYPES: LogEventType[] = [
  "device_approved",
  "device_rejected",
  "device_discovered",
  "anomaly_detected",
  "device_quarantined",
  "device_released",
  "device_blocked",
  "login",
  "logout",
  "settings_changed",
];

export default function LogsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<LogEventType | "all">("all");
  const [performerFilter, setPerformerFilter] = useState<"all" | "system" | "admin">("all");

  const { data: logs, isLoading } = useQuery<LogEntry[]>({
    queryKey: ["/api/logs"],
  });

  const filteredLogs = logs?.filter((log) => {
    const matchesSearch =
      log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.deviceName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesEventType = eventTypeFilter === "all" || log.eventType === eventTypeFilter;
    const matchesPerformer = performerFilter === "all" || log.performedBy === performerFilter;
    return matchesSearch && matchesEventType && matchesPerformer;
  }) || [];

  const handleExport = () => {
    if (!filteredLogs.length) return;
    
    const csvContent = [
      ["Timestamp", "Event Type", "Performed By", "Device", "Details"].join(","),
      ...filteredLogs.map((log) =>
        [
          new Date(log.timestamp).toISOString(),
          log.eventType,
          log.performedBy,
          log.deviceName || "-",
          `"${log.details.replace(/"/g, '""')}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iot-security-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Logs & Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete history of all security events and system actions
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={filteredLogs.length === 0}
          data-testid="button-export-logs"
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Event Log</CardTitle>
                <CardDescription>
                  {filteredLogs.length} event{filteredLogs.length !== 1 ? "s" : ""} found
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-full sm:w-48"
                  data-testid="input-search-logs"
                />
              </div>
              <div className="flex gap-2">
                <Select value={eventTypeFilter} onValueChange={(v) => setEventTypeFilter(v as LogEventType | "all")}>
                  <SelectTrigger className="w-44" data-testid="select-event-type">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Event Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Events</SelectItem>
                    {ALL_EVENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {EVENT_TYPE_LABELS[type].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={performerFilter} onValueChange={(v) => setPerformerFilter(v as "all" | "system" | "admin")}>
                  <SelectTrigger className="w-32" data-testid="select-performer">
                    <SelectValue placeholder="By" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No logs found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery || eventTypeFilter !== "all" || performerFilter !== "all"
                  ? "Try adjusting your filters"
                  : "Events will appear here as they occur"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Performed By</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => {
                    const eventConfig = EVENT_TYPE_LABELS[log.eventType as LogEventType];
                    return (
                      <TableRow
                        key={log.id}
                        className="hover-elevate"
                        data-testid={`row-log-${log.id}`}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(log.timestamp).toLocaleString()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={eventConfig?.variant || "outline"}>
                            {eventConfig?.label || log.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm">
                            {log.performedBy === "system" ? (
                              <>
                                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">System</span>
                              </>
                            ) : (
                              <>
                                <User className="h-3.5 w-3.5" />
                                <span>Admin</span>
                              </>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">
                          {log.deviceName || "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                          {log.details}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
