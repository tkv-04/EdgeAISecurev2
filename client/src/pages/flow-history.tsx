import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Brain,
  RefreshCw,
  Activity,
  Clock,
  Filter,
  Download,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { useToast } from "@/hooks/use-toast";

interface FlowSummary {
  deviceId: number;
  name: string;
  ipAddress: string;
  flowCount: number;
  protocols: string[];
  firstSeen: string;
  lastSeen: string;
}

interface TrainingResult {
  deviceId: number;
  name: string;
  flowsProcessed: number;
  hasModel: boolean;
  confidence: number;
  samples: number;
}

interface Device {
  id: number;
  name: string;
  ipAddress: string;
  status: string;
  hasAiModel?: boolean;
  aiConfidence?: number;
  aiSamples?: number;
}

export default function FlowHistoryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDevice, setSelectedDevice] = useState<string>("all");

  // Fetch devices
  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ["/api/devices"],
  });

  // Fetch flow statistics
  const { data: flowStats, isLoading: statsLoading } = useQuery<{
    totalFlows: number;
    oldestFlow: string;
    newestFlow: string;
    deviceBreakdown: FlowSummary[];
  }>({
    queryKey: ["/api/flows/stats"],
    refetchInterval: 30000,
  });

  // Train from history mutation
  const trainMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/train-from-history", { method: "POST" });
      if (!res.ok) throw new Error("Training failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Training Complete",
        description: `Trained ${data.results?.length || 0} device models successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
    },
    onError: () => {
      toast({
        title: "Training Failed",
        description: "Failed to train models from historical data",
        variant: "destructive",
      });
    },
  });

  // Get approved/monitoring devices with flow data
  const devicesWithData = devices.filter(
    (d) => d.status === "approved" || d.status === "monitoring"
  );

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            Flow History & AI Training
          </h1>
          <p className="text-muted-foreground mt-1">
            View historical flow data and train AI models
          </p>
        </div>
        <Button
          onClick={() => trainMutation.mutate()}
          disabled={trainMutation.isPending}
          className="gap-2"
        >
          {trainMutation.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          Train AI from History
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Activity className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Flows</p>
                <p className="text-2xl font-bold">
                  {flowStats?.totalFlows?.toLocaleString() || "0"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Zap className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Devices with AI</p>
                <p className="text-2xl font-bold">
                  {devices.filter((d) => d.hasAiModel).length} / {devicesWithData.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Oldest Flow</p>
                <p className="text-sm font-medium">
                  {flowStats?.oldestFlow
                    ? formatDate(flowStats.oldestFlow)
                    : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Newest Flow</p>
                <p className="text-sm font-medium">
                  {flowStats?.newestFlow
                    ? formatDate(flowStats.newestFlow)
                    : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Device AI Status Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Device AI Model Status
          </CardTitle>
          <CardDescription>
            Current AI model training status for each device
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>AI Model</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devicesWithData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No approved or monitoring devices found
                  </TableCell>
                </TableRow>
              ) : (
                devicesWithData.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell className="font-medium">{device.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {device.ipAddress}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          device.status === "approved" ? "default" : "secondary"
                        }
                      >
                        {device.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {device.hasAiModel ? (
                        <Badge variant="default" className="bg-green-500">
                          ✓ Trained
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not Trained
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={(device.aiConfidence || 0) * 100}
                          className="w-20 h-2"
                        />
                        <span className="text-sm">
                          {Math.round((device.aiConfidence || 0) * 100)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {device.aiSamples?.toLocaleString() || 0}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Training Results (if just trained) */}
      {trainMutation.data?.results && (
        <Card>
          <CardHeader>
            <CardTitle className="text-green-600 flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Training Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Flows Processed</TableHead>
                  <TableHead>Model Status</TableHead>
                  <TableHead>New Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trainMutation.data.results.map((result: TrainingResult) => (
                  <TableRow key={result.deviceId}>
                    <TableCell className="font-medium">{result.name}</TableCell>
                    <TableCell>{result.flowsProcessed.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge
                        variant={result.hasModel ? "default" : "outline"}
                        className={result.hasModel ? "bg-green-500" : ""}
                      >
                        {result.hasModel ? "✓ Trained" : "No Data"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {Math.round(result.confidence * 100)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <h3 className="font-semibold mb-2">How AI Training Works</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Historical flow events are stored in the database as devices communicate</li>
            <li>• Click "Train AI from History" to build behavioral models from this data</li>
            <li>• Models learn traffic patterns, protocols, destinations, and timing</li>
            <li>• Once trained, the AI can detect anomalous behavior in real-time</li>
            <li>• Higher confidence = more reliable anomaly detection</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
