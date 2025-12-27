import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ShieldBan, Wifi, Server, Globe } from "lucide-react";
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

interface NetworkBlockSettings {
  enabled: boolean;
  method: "local" | "openwrt" | "pihole";
  openwrtHost?: string;
  openwrtUser?: string;
  openwrtPassword?: string;
  piholeHost?: string;
  piholeApiKey?: string;
}

interface BlockStatus {
  arping: boolean;
  nft: boolean;
  gateway: string | null;
  interface: string | null;
  blockedDevices: Array<{
    ipAddress: string;
    macAddress: string;
    reason: string;
  }>;
}

// OpenWRT Settings subcomponent with test connection
function OpenWRTSettings({ 
  localSettings, 
  setLocalSettings 
}: { 
  localSettings: NetworkBlockSettings; 
  setLocalSettings: React.Dispatch<React.SetStateAction<NetworkBlockSettings>>;
}) {
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/network-block/test-openwrt"),
    onSuccess: (data: any) => {
      setTestResult(data);
      toast({
        title: data.success ? "Connected!" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Test request failed", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
      <h4 className="font-medium text-sm">OpenWRT Configuration</h4>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="openwrt-host">Router IP</Label>
          <Input
            id="openwrt-host"
            placeholder="192.168.1.1"
            value={localSettings.openwrtHost || ""}
            onChange={(e) => setLocalSettings((prev) => ({ ...prev, openwrtHost: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="openwrt-user">Username</Label>
          <Input
            id="openwrt-user"
            placeholder="root"
            value={localSettings.openwrtUser || ""}
            onChange={(e) => setLocalSettings((prev) => ({ ...prev, openwrtUser: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="openwrt-password">Password</Label>
          <Input
            id="openwrt-password"
            type="password"
            placeholder="••••••••"
            value={localSettings.openwrtPassword || ""}
            onChange={(e) => setLocalSettings((prev) => ({ ...prev, openwrtPassword: e.target.value }))}
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || !localSettings.openwrtHost}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>
        {testResult && (
          <span className={`text-sm ${testResult.success ? "text-green-600" : "text-red-600"}`}>
            {testResult.message}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Requires OpenWRT with uhttpd or luci-mod-rpc for ubus API access.
      </p>
    </div>
  );
}

export function NetworkBlockingSettings() {
  const { toast } = useToast();

  const { data: settings } = useQuery<NetworkBlockSettings>({
    queryKey: ["/api/network-block/settings"],
  });

  const { data: status } = useQuery<BlockStatus>({
    queryKey: ["/api/network-block/status"],
  });

  const [localSettings, setLocalSettings] = useState<NetworkBlockSettings>({
    enabled: false,
    method: "local",
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<NetworkBlockSettings>) =>
      apiRequest("POST", "/api/network-block/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/network-block/settings"] });
      toast({ title: "Saved", description: "Blocking settings updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(localSettings);
  };

  const methodDescriptions: Record<string, string> = {
    local: "Blocks devices from communicating with this Pi only. Simple but limited.",
    openwrt: "Pushes firewall rules to your OpenWRT router for network-wide blocking.",
    pihole: "Uses Pi-hole DNS to block device traffic at the DNS level.",
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <ShieldBan className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Network Blocking</CardTitle>
            <CardDescription>
              Configure how blocked devices are handled on your network
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status indicators */}
        {status && (
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status.gateway ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Gateway: {status.gateway || "Not found"}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status.nft ? "bg-green-500" : "bg-yellow-500"}`} />
              <span className="text-muted-foreground">nftables: {status.nft ? "Available" : "Missing"}</span>
            </div>
            {status.blockedDevices.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-muted-foreground">{status.blockedDevices.length} device(s) blocked</span>
              </div>
            )}
          </div>
        )}

        {/* Enable/disable toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="blocking-enabled">Enable Blocking</Label>
            <p className="text-xs text-muted-foreground">
              Allow the system to block suspicious or rejected devices
            </p>
          </div>
          <Switch
            id="blocking-enabled"
            checked={localSettings.enabled}
            onCheckedChange={(checked) => setLocalSettings((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        {/* Method selection */}
        <div className="space-y-3">
          <Label>Blocking Method</Label>
          <Select
            value={localSettings.method}
            onValueChange={(value: "local" | "openwrt" | "pihole") =>
              setLocalSettings((prev) => ({ ...prev, method: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  <span>Local (Pi only)</span>
                </div>
              </SelectItem>
              <SelectItem value="openwrt">
                <div className="flex items-center gap-2">
                  <Wifi className="h-4 w-4" />
                  <span>OpenWRT Router</span>
                </div>
              </SelectItem>
              <SelectItem value="pihole">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  <span>Pi-hole DNS</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {methodDescriptions[localSettings.method]}
          </p>
        </div>

        {/* OpenWRT settings */}
        {localSettings.method === "openwrt" && (
          <OpenWRTSettings 
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
          />
        )}

        {/* Pi-hole settings */}
        {localSettings.method === "pihole" && (
          <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium text-sm">Pi-hole Configuration</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pihole-host">Pi-hole Host</Label>
                <Input
                  id="pihole-host"
                  placeholder="192.168.1.2"
                  value={localSettings.piholeHost || ""}
                  onChange={(e) => setLocalSettings((prev) => ({ ...prev, piholeHost: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pihole-api">API Key</Label>
                <Input
                  id="pihole-api"
                  type="password"
                  placeholder="API Token from Pi-hole settings"
                  value={localSettings.piholeApiKey || ""}
                  onChange={(e) => setLocalSettings((prev) => ({ ...prev, piholeApiKey: e.target.value }))}
                />
              </div>
            </div>
          </div>
        )}

        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Blocking Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
