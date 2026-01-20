import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Shield,
  AlertTriangle,
  RefreshCw,
  Clock,
  Filter,
  Info,
  AlertCircle,
  XCircle,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface SuricataAlert {
  timestamp: string;
  eventType: string;
  srcIp: string;
  srcPort: number;
  destIp: string;
  destPort: number;
  protocol: string;
  appProto?: string;
  alert?: {
    action: string;
    gid: number;
    signatureId: number;
    rev: number;
    signature: string;
    category: string;
    severity: number;
  };
}

export default function SuricataAlertsPage() {
  const [filter, setFilter] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: alerts = [], isLoading, refetch } = useQuery<SuricataAlert[]>({
    queryKey: ["/api/suricata/alerts", refreshKey],
    queryFn: async () => {
      const response = await fetch("/api/suricata/alerts");
      if (!response.ok) {
        throw new Error("Failed to fetch Suricata alerts");
      }
      return response.json();
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
    refetch();
  };

  const filteredAlerts = alerts.filter((alert) => {
    if (filter === "all") return true;
    if (filter === "high") return alert.alert?.severity === 1;
    if (filter === "medium") return alert.alert?.severity === 2;
    if (filter === "low") return (alert.alert?.severity ?? 3) >= 3;
    return true;
  });

  const getPriorityBadge = (severity: number | undefined) => {
    switch (severity) {
      case 1:
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            High
          </Badge>
        );
      case 2:
        return (
          <Badge variant="default" className="bg-orange-500 gap-1">
            <AlertCircle className="h-3 w-3" />
            Medium
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Info className="h-3 w-3" />
            Low
          </Badge>
        );
    }
  };

  const getClassificationColor = (classification: string) => {
    if (classification.includes("attack") || classification.includes("exploit")) {
      return "text-red-500";
    }
    if (classification.includes("suspicious") || classification.includes("bad")) {
      return "text-orange-500";
    }
    return "text-muted-foreground";
  };

  const formatTimestamp = (ts: string) => {
    if (!ts) return "N/A";
    try {
      // API returns ISO format like "2026-01-20T18:38:21.762Z"
      const date = new Date(ts);
      return date.toLocaleString();
    } catch {
      return ts;
    }
  };

  // Count alerts by priority (using severity from alert object)
  const highCount = alerts.filter((a) => a.alert?.severity === 1).length;
  const mediumCount = alerts.filter((a) => a.alert?.severity === 2).length;
  const lowCount = alerts.filter((a) => (a.alert?.severity ?? 3) >= 3).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Suricata IDS Alerts
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time intrusion detection alerts from Suricata
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => window.open('/api/suricata/alerts/export', '_blank')}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={handleRefresh} disabled={isLoading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Shield className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Alerts</p>
                <p className="text-2xl font-bold">{alerts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={highCount > 0 ? "border-red-500" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">High Priority</p>
                <p className="text-2xl font-bold text-red-500">{highCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Medium Priority</p>
                <p className="text-2xl font-bold text-orange-500">{mediumCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-500/10 rounded-lg">
                <Info className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Priority</p>
                <p className="text-2xl font-bold">{lowCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter:</span>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Alerts</SelectItem>
            <SelectItem value="high">High Priority</SelectItem>
            <SelectItem value="medium">Medium Priority</SelectItem>
            <SelectItem value="low">Low Priority</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Alert Log</CardTitle>
          <CardDescription>
            Latest {filteredAlerts.length} Suricata IDS alerts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No Suricata alerts found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Signature</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Protocol</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((alert, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatTimestamp(alert.timestamp)}
                      </TableCell>
                      <TableCell>{getPriorityBadge(alert.alert?.severity)}</TableCell>
                      <TableCell className="max-w-md">
                        <div className="space-y-1">
                          <p className="font-medium text-sm truncate" title={alert.alert?.signature ?? "Unknown"}>
                            {alert.alert?.signature ?? "Unknown signature"}
                          </p>
                          <p className={`text-xs ${getClassificationColor(alert.alert?.category ?? "")}`}>
                            {alert.alert?.category ?? "Unknown"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {alert.srcIp}:{alert.srcPort}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {alert.destIp}:{alert.destPort}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{alert.protocol}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Box */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <h3 className="font-semibold mb-2">About Suricata Alerts</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• <strong>High Priority (1):</strong> Critical threats requiring immediate attention</li>
            <li>• <strong>Medium Priority (2):</strong> Suspicious activity worth investigating</li>
            <li>• <strong>Low Priority (3+):</strong> Informational or miscellaneous activity</li>
            <li>• Alerts are parsed from <code>/var/log/suricata/fast.log</code></li>
            <li>• Auto-refreshes every 10 seconds</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
