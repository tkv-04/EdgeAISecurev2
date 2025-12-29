import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Activity, Wifi, Server, Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TrafficMonitorSettings {
  enabled: boolean;
  method: "local" | "openwrt" | "arp";
  intervalSeconds: number;
  openwrtHost?: string;
  openwrtUser?: string;
  openwrtPassword?: string;
}

export function TrafficMonitoringSettings() {
  const { toast } = useToast();

  const { data: settings } = useQuery<TrafficMonitorSettings>({
    queryKey: ["/api/traffic-monitor/settings"],
  });

  const [localSettings, setLocalSettings] = useState<TrafficMonitorSettings>({
    enabled: true,
    method: "arp",
    intervalSeconds: 30,
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<TrafficMonitorSettings>) =>
      apiRequest("POST", "/api/traffic-monitor/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/traffic-monitor/settings"] });
      toast({ title: "Saved", description: "Traffic monitoring settings updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(localSettings);
  };

  const methodDescriptions: Record<string, string> = {
    local: "Uses iptables counters to track per-device traffic. Requires Pi as gateway.",
    openwrt: "Pulls traffic statistics from your OpenWRT router via API.",
    arp: "Tracks device online/offline status via ARP cache and ping. No byte counts.",
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Traffic Monitoring</CardTitle>
            <CardDescription>
              Configure how device traffic is monitored
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/disable toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="monitoring-enabled">Enable Traffic Monitoring</Label>
            <p className="text-xs text-muted-foreground">
              Track network traffic for each device
            </p>
          </div>
          <Switch
            id="monitoring-enabled"
            checked={localSettings.enabled}
            onCheckedChange={(checked) => setLocalSettings((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        {/* Method selection */}
        <div className="space-y-3">
          <Label>Monitoring Method</Label>
          <Select
            value={localSettings.method}
            onValueChange={(value: "local" | "openwrt" | "arp") =>
              setLocalSettings((prev) => ({ ...prev, method: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="arp">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4" />
                  <span>ARP/Ping (Activity Only)</span>
                </div>
              </SelectItem>
              <SelectItem value="local">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  <span>Local (Pi Gateway)</span>
                </div>
              </SelectItem>
              <SelectItem value="openwrt">
                <div className="flex items-center gap-2">
                  <Wifi className="h-4 w-4" />
                  <span>OpenWRT Router</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {methodDescriptions[localSettings.method]}
          </p>
        </div>

        {/* Interval setting */}
        <div className="space-y-2">
          <Label htmlFor="interval">Update Interval (seconds)</Label>
          <Input
            id="interval"
            type="number"
            min={5}
            max={300}
            value={localSettings.intervalSeconds}
            onChange={(e) => setLocalSettings((prev) => ({ 
              ...prev, 
              intervalSeconds: parseInt(e.target.value) || 30 
            }))}
            className="w-32"
          />
        </div>

        {/* OpenWRT settings (show when OpenWRT method selected) */}
        {localSettings.method === "openwrt" && (
          <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium text-sm">OpenWRT Configuration</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Uses the same credentials as blocking settings if configured there.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="openwrt-host-traffic">Router IP</Label>
                <Input
                  id="openwrt-host-traffic"
                  placeholder="192.168.1.1"
                  value={localSettings.openwrtHost || ""}
                  onChange={(e) => setLocalSettings((prev) => ({ ...prev, openwrtHost: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openwrt-user-traffic">Username</Label>
                <Input
                  id="openwrt-user-traffic"
                  placeholder="root"
                  value={localSettings.openwrtUser || ""}
                  onChange={(e) => setLocalSettings((prev) => ({ ...prev, openwrtUser: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openwrt-password-traffic">Password</Label>
                <Input
                  id="openwrt-password-traffic"
                  type="password"
                  placeholder="••••••••"
                  value={localSettings.openwrtPassword || ""}
                  onChange={(e) => setLocalSettings((prev) => ({ ...prev, openwrtPassword: e.target.value }))}
                />
              </div>
            </div>
          </div>
        )}

        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Monitoring Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
