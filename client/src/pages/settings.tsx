import { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Shield,
  Bell,
  Moon,
  Sun,
  RefreshCw,
  Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme-context";
import { useSettings } from "@/lib/settings-context";
import { NetworkBlockingSettings } from "@/components/network-blocking-settings";
import type { Settings } from "@shared/schema";

export default function SettingsPage() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings } = useSettings();

  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalSettings({ ...settings, theme });
  }, [settings, theme]);

  const handleSensitivityChange = (value: number[]) => {
    const sensitivity = value[0] <= 33 ? "low" : value[0] <= 66 ? "medium" : "high";
    setLocalSettings((prev) => ({ ...prev, anomalySensitivity: sensitivity }));
    setHasChanges(true);
  };

  const getSensitivityValue = () => {
    switch (localSettings.anomalySensitivity) {
      case "low":
        return 16;
      case "medium":
        return 50;
      case "high":
        return 84;
      default:
        return 50;
    }
  };

  const handleRefreshIntervalChange = (value: string) => {
    setLocalSettings((prev) => ({
      ...prev,
      alertRefreshInterval: parseInt(value, 10),
    }));
    setHasChanges(true);
  };

  const handleThemeChange = (checked: boolean) => {
    const newTheme = checked ? "dark" : "light";
    setLocalSettings((prev) => ({ ...prev, theme: newTheme }));
    setTheme(newTheme);
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings({
      anomalySensitivity: localSettings.anomalySensitivity,
      alertRefreshInterval: localSettings.alertRefreshInterval,
      learningDurationSeconds: localSettings.learningDurationSeconds,
      theme: localSettings.theme,
    });
    toast({
      title: "Settings Saved",
      description: "Your preferences have been updated successfully.",
    });
    setHasChanges(false);
  };

  const handleLearningDurationChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(10, Math.min(86400, parsed)); // 10s–24 hours (1 day)
    setLocalSettings((prev) => ({
      ...prev,
      learningDurationSeconds: clamped,
    }));
    setHasChanges(true);
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  const LEARNING_PRESETS = [
    { label: "1 minute", value: 60 },
    { label: "5 minutes", value: 300 },
    { label: "15 minutes", value: 900 },
    { label: "1 hour", value: 3600 },
    { label: "6 hours", value: 21600 },
    { label: "12 hours", value: 43200 },
    { label: "1 day", value: 86400 },
  ];

  const handleReset = () => {
    const defaultSettings: Settings = {
      anomalySensitivity: "medium",
      alertRefreshInterval: 5,
      theme: "light",
      learningDurationSeconds: 60,
    };
    setLocalSettings(defaultSettings);
    updateSettings(defaultSettings);
    setTheme("light");
    toast({
      title: "Settings Reset",
      description: "All settings have been restored to defaults.",
    });
    setHasChanges(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure anomaly detection and system preferences
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleReset}
            data-testid="button-reset-settings"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            data-testid="button-save-settings"
          >
            <Save className="mr-2 h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Anomaly Detection</CardTitle>
                <CardDescription>
                  Configure the sensitivity of threat detection and learning behavior
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="sensitivity">Detection Sensitivity</Label>
                <span className="text-sm font-medium capitalize px-2.5 py-0.5 rounded-full bg-muted">
                  {localSettings.anomalySensitivity}
                </span>
              </div>
              <Slider
                id="sensitivity"
                min={0}
                max={100}
                step={1}
                value={[getSensitivityValue()]}
                onValueChange={handleSensitivityChange}
                className="w-full"
                data-testid="slider-sensitivity"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Low</span>
                <span>Medium</span>
                <span>High</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {localSettings.anomalySensitivity === "low" &&
                  "Fewer alerts, only major anomalies trigger detection."}
                {localSettings.anomalySensitivity === "medium" &&
                  "Balanced detection with moderate alert frequency."}
                {localSettings.anomalySensitivity === "high" &&
                  "Maximum sensitivity, more alerts for minor deviations."}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="learning-duration">Baseline Learning Time</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {formatDuration(localSettings.learningDurationSeconds ?? 60)}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {LEARNING_PRESETS.map((preset) => {
                    const isSelected =
                      (localSettings.learningDurationSeconds ?? 60) === preset.value;
                    return (
                      <Button
                        key={preset.value}
                        type="button"
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        onClick={() => {
                          setLocalSettings((prev) => ({
                            ...prev,
                            learningDurationSeconds: preset.value,
                          }));
                          setHasChanges(true);
                        }}
                        data-testid={`button-learning-preset-${preset.value}`}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="learning-duration-custom" className="text-xs text-muted-foreground">
                    Custom:
                  </Label>
                  <Input
                    id="learning-duration-custom"
                    type="number"
                    min={10}
                    max={86400}
                    value={localSettings.learningDurationSeconds ?? 60}
                    onChange={(e) => handleLearningDurationChange(e.target.value)}
                    className="w-32"
                    placeholder="seconds"
                    data-testid="input-learning-duration"
                  />
                  <span className="text-xs text-muted-foreground">
                    (10s–86400s / 1 day)
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Controls how long newly approved devices stay in the learning phase before being marked
                as fully approved. Longer durations allow for more comprehensive baseline behavior analysis.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">Alert Settings</CardTitle>
                <CardDescription>
                  Configure alert refresh and notification preferences
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="refresh-interval">Alert Refresh Interval</Label>
              <Select
                value={localSettings.alertRefreshInterval.toString()}
                onValueChange={handleRefreshIntervalChange}
              >
                <SelectTrigger id="refresh-interval" data-testid="select-refresh-interval">
                  <SelectValue placeholder="Select interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Every 3 seconds</SelectItem>
                  <SelectItem value="5">Every 5 seconds</SelectItem>
                  <SelectItem value="10">Every 10 seconds</SelectItem>
                  <SelectItem value="15">Every 15 seconds</SelectItem>
                  <SelectItem value="30">Every 30 seconds</SelectItem>
                  <SelectItem value="60">Every minute</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How often the dashboard checks for new alerts and updates device metrics.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              {theme === "dark" ? (
                <Moon className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Sun className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <CardTitle className="text-lg">Appearance</CardTitle>
                <CardDescription>
                  Customize the look and feel of your dashboard
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="dark-mode">Dark Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Enable dark theme for reduced eye strain in low-light environments
                </p>
              </div>
              <Switch
                id="dark-mode"
                checked={localSettings.theme === "dark"}
                onCheckedChange={handleThemeChange}
                data-testid="switch-dark-mode"
              />
            </div>
          </CardContent>
        </Card>

        <NetworkBlockingSettings />
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">About</CardTitle>
              <CardDescription>
                Edge AI IoT Security Center
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-muted-foreground">Version</p>
              <p className="font-mono">1.0.0</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Last Updated</p>
              <p className="font-mono">{new Date().toLocaleDateString()}</p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <p className="text-muted-foreground">Description</p>
              <p>
                A comprehensive IoT network security monitoring solution with edge AI-powered
                anomaly detection and automatic device quarantine capabilities.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
