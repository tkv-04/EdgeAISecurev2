import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { Settings } from "@shared/schema";

interface SettingsContextType {
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
}

const defaultSettings: Settings = {
  anomalySensitivity: "medium",
  alertRefreshInterval: 5,
  theme: "light",
  learningDurationSeconds: 60,
};

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    return defaultSettings;
  });

  useEffect(() => {
    // Load settings from the backend on mount
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        setSettings((prev) => ({ ...prev, ...data }));
      } catch {
        // Ignore errors and keep defaults
      }
    };

    void loadSettings();
  }, []);

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));

    // Persist settings to backend
    void (async () => {
      try {
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSettings),
        });
      } catch {
        // Ignore network errors for now
      }
    })();
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
