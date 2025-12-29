import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { storage } from "./storage";

const execAsync = promisify(exec);

// ==================== Types ====================

export type MonitoringMethod = "local" | "openwrt" | "arp";

export interface TrafficMonitorSettings {
    enabled: boolean;
    method: MonitoringMethod;
    intervalSeconds: number;
    // OpenWRT settings (shared with network-block)
    openwrtHost?: string;
    openwrtUser?: string;
    openwrtPassword?: string;
}

interface InterfaceStats {
    interface: string;
    rxBytes: number;
    rxPackets: number;
    txBytes: number;
    txPackets: number;
}

interface DeviceTrafficStats {
    deviceId: number;
    deviceName: string;
    ipAddress: string;
    macAddress: string;
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    lastUpdated: Date;
    online: boolean;
}

// ==================== State ====================

let settings: TrafficMonitorSettings = {
    enabled: true,
    method: "arp",
    intervalSeconds: 30,
};

// Cache for device traffic data
const deviceTrafficCache = new Map<string, DeviceTrafficStats>();
const iptablesRuleSetup = new Set<string>(); // Track which IPs have accounting rules

// ==================== Settings ====================

export function getTrafficMonitorSettings(): TrafficMonitorSettings {
    return { ...settings };
}

export function updateTrafficMonitorSettings(updates: Partial<TrafficMonitorSettings>): TrafficMonitorSettings {
    settings = { ...settings, ...updates };
    console.log("[TrafficMonitor] Settings updated:", settings);
    return settings;
}

// ==================== Interface Stats ====================

export async function getInterfaceStats(): Promise<InterfaceStats[]> {
    try {
        const content = await readFile("/proc/net/dev", "utf-8");
        const lines = content.trim().split("\n").slice(2);

        return lines.map((line) => {
            const parts = line.trim().split(/\s+/);
            const ifaceName = parts[0].replace(":", "");

            return {
                interface: ifaceName,
                rxBytes: parseInt(parts[1]) || 0,
                rxPackets: parseInt(parts[2]) || 0,
                txBytes: parseInt(parts[9]) || 0,
                txPackets: parseInt(parts[10]) || 0,
            };
        }).filter((stat) => stat.interface !== "lo");
    } catch (error) {
        console.error("[TrafficMonitor] Error reading interface stats:", error);
        return [];
    }
}

// ==================== Local Mode (iptables counters) ====================

/**
 * Setup iptables accounting rules for a device
 * Creates INPUT and OUTPUT rules to count traffic per IP
 */
async function setupIptablesAccounting(ipAddress: string): Promise<void> {
    if (iptablesRuleSetup.has(ipAddress)) return;

    try {
        // Check if rule already exists
        const { stdout } = await execAsync(
            `sudo iptables -L -v -n 2>/dev/null | grep -c "${ipAddress}" || echo "0"`
        );

        if (parseInt(stdout.trim()) === 0) {
            // Add accounting rules (ACCEPT to not block, just count)
            await execAsync(`sudo iptables -A INPUT -s ${ipAddress} -j ACCEPT 2>/dev/null || true`);
            await execAsync(`sudo iptables -A OUTPUT -d ${ipAddress} -j ACCEPT 2>/dev/null || true`);
            console.log(`[TrafficMonitor] Added iptables accounting for ${ipAddress}`);
        }

        iptablesRuleSetup.add(ipAddress);
    } catch (error) {
        console.error(`[TrafficMonitor] Failed to setup iptables for ${ipAddress}:`, error);
    }
}

/**
 * Get traffic stats from iptables counters
 */
async function getIptablesTraffic(ipAddress: string): Promise<{ bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number }> {
    try {
        // Get INPUT chain stats (traffic FROM this IP)
        const { stdout: inputStats } = await execAsync(
            `sudo iptables -L INPUT -v -n -x 2>/dev/null | grep "${ipAddress}" | awk '{print $2, $1}' | head -1`
        );

        // Get OUTPUT chain stats (traffic TO this IP)
        const { stdout: outputStats } = await execAsync(
            `sudo iptables -L OUTPUT -v -n -x 2>/dev/null | grep "${ipAddress}" | awk '{print $2, $1}' | head -1`
        );

        const [bytesIn, packetsIn] = (inputStats.trim().split(" ").map(Number));
        const [bytesOut, packetsOut] = (outputStats.trim().split(" ").map(Number));

        return {
            bytesIn: bytesIn || 0,
            bytesOut: bytesOut || 0,
            packetsIn: packetsIn || 0,
            packetsOut: packetsOut || 0,
        };
    } catch {
        return { bytesIn: 0, bytesOut: 0, packetsIn: 0, packetsOut: 0 };
    }
}

// ==================== OpenWRT Mode ====================

/**
 * Get OpenWRT ubus session token
 */
async function openwrtLogin(): Promise<string | null> {
    if (!settings.openwrtHost || !settings.openwrtUser || !settings.openwrtPassword) {
        return null;
    }

    try {
        const response = await fetch(`http://${settings.openwrtHost}/ubus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "call",
                params: [
                    "00000000000000000000000000000000",
                    "session",
                    "login",
                    { username: settings.openwrtUser, password: settings.openwrtPassword },
                ],
            }),
        });

        const data = await response.json() as any;
        if (data.result && data.result[0] === 0) {
            return data.result[1]?.ubus_rpc_session || null;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get traffic stats from OpenWRT router
 */
async function getOpenwrtTraffic(): Promise<Map<string, { bytesIn: number; bytesOut: number }>> {
    const trafficMap = new Map<string, { bytesIn: number; bytesOut: number }>();

    const session = await openwrtLogin();
    if (!session) {
        console.log("[TrafficMonitor] OpenWRT login failed");
        return trafficMap;
    }

    try {
        // Try to get bandwidth stats from luci-bwc or network.device
        const response = await fetch(`http://${settings.openwrtHost}/ubus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "call",
                params: [session, "network.device", "status", {}],
            }),
        });

        const data = await response.json() as any;
        if (data.result && data.result[1]) {
            // Parse device stats - structure varies by OpenWRT version
            console.log("[TrafficMonitor] Got OpenWRT network stats");
        }

        // Alternative: Try to get DHCP leases with traffic
        const leasesResponse = await fetch(`http://${settings.openwrtHost}/ubus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "call",
                params: [session, "dhcp", "ipv4leases", {}],
            }),
        });

        const leasesData = await leasesResponse.json() as any;
        if (leasesData.result && leasesData.result[1]?.dhcp_leases) {
            // We got DHCP leases but typically no per-client traffic
            // Would need luci-app-nlbwmon or similar for real traffic stats
            for (const lease of leasesData.result[1].dhcp_leases) {
                trafficMap.set(lease.ipaddr, { bytesIn: 0, bytesOut: 0 });
            }
        }
    } catch (error) {
        console.error("[TrafficMonitor] OpenWRT traffic fetch error:", error);
    }

    return trafficMap;
}

// ==================== ARP Mode (Activity Only) ====================

/**
 * Check if device is online via ping
 */
async function pingDevice(ipAddress: string): Promise<boolean> {
    try {
        await execAsync(`ping -c 1 -W 1 ${ipAddress} > /dev/null 2>&1`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get ARP cache to see which devices have been seen
 */
async function getArpCache(): Promise<Map<string, string>> {
    const arpMap = new Map<string, string>(); // IP -> MAC

    try {
        const { stdout } = await execAsync("cat /proc/net/arp 2>/dev/null");
        const lines = stdout.trim().split("\n").slice(1);

        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts[2] !== "0x0") { // 0x0 means incomplete
                arpMap.set(parts[0], parts[3].toLowerCase());
            }
        }
    } catch {
        // Ignore errors
    }

    return arpMap;
}

// ==================== Main Traffic Collection ====================

/**
 * Get per-device traffic stats using the configured method
 */
export async function getDeviceTraffic(): Promise<DeviceTrafficStats[]> {
    const devices = await storage.getDevices();
    const approvedDevices = devices.filter((d) =>
        ["approved", "active", "monitoring", "learning", "anomalous"].includes(d.status)
    );

    const stats: DeviceTrafficStats[] = [];
    const arpCache = await getArpCache();

    switch (settings.method) {
        case "local":
            // Use iptables counters
            for (const device of approvedDevices) {
                await setupIptablesAccounting(device.ipAddress);
                const traffic = await getIptablesTraffic(device.ipAddress);
                const online = await pingDevice(device.ipAddress);

                stats.push({
                    deviceId: device.id,
                    deviceName: device.name,
                    ipAddress: device.ipAddress,
                    macAddress: device.macAddress,
                    ...traffic,
                    lastUpdated: new Date(),
                    online,
                });
            }
            break;

        case "openwrt":
            // Pull from OpenWRT router
            const openwrtTraffic = await getOpenwrtTraffic();
            for (const device of approvedDevices) {
                const traffic = openwrtTraffic.get(device.ipAddress) || { bytesIn: 0, bytesOut: 0 };
                const online = arpCache.has(device.ipAddress);

                stats.push({
                    deviceId: device.id,
                    deviceName: device.name,
                    ipAddress: device.ipAddress,
                    macAddress: device.macAddress,
                    bytesIn: traffic.bytesIn,
                    bytesOut: traffic.bytesOut,
                    packetsIn: 0,
                    packetsOut: 0,
                    lastUpdated: new Date(),
                    online,
                });
            }
            break;

        case "arp":
        default:
            // Just track online status via ARP/ping
            for (const device of approvedDevices) {
                const inArp = arpCache.has(device.ipAddress);
                const online = inArp || await pingDevice(device.ipAddress);

                // Use cached values or device's stored traffic rate
                const cached = deviceTrafficCache.get(device.ipAddress);

                stats.push({
                    deviceId: device.id,
                    deviceName: device.name,
                    ipAddress: device.ipAddress,
                    macAddress: device.macAddress,
                    bytesIn: cached?.bytesIn || 0,
                    bytesOut: cached?.bytesOut || 0,
                    packetsIn: cached?.packetsIn || 0,
                    packetsOut: cached?.packetsOut || 0,
                    lastUpdated: new Date(),
                    online,
                });

                // Update cache
                if (stats.length > 0) {
                    deviceTrafficCache.set(device.ipAddress, stats[stats.length - 1]);
                }
            }
            break;
    }

    return stats;
}

/**
 * Get network summary stats
 */
export async function getNetworkSummary(): Promise<{
    totalRxBytes: number;
    totalTxBytes: number;
    totalRxPackets: number;
    totalTxPackets: number;
    interfaces: InterfaceStats[];
    activeDevices: number;
    method: MonitoringMethod;
}> {
    const stats = await getInterfaceStats();
    const deviceTraffic = await getDeviceTraffic();
    const onlineDevices = deviceTraffic.filter((d) => d.online).length;

    const totals = stats.reduce(
        (acc, stat) => ({
            totalRxBytes: acc.totalRxBytes + stat.rxBytes,
            totalTxBytes: acc.totalTxBytes + stat.txBytes,
            totalRxPackets: acc.totalRxPackets + stat.rxPackets,
            totalTxPackets: acc.totalTxPackets + stat.txPackets,
        }),
        { totalRxBytes: 0, totalTxBytes: 0, totalRxPackets: 0, totalTxPackets: 0 }
    );

    return {
        ...totals,
        interfaces: stats,
        activeDevices: onlineDevices,
        method: settings.method,
    };
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ==================== Export ====================

export const trafficMonitor = {
    getSettings: getTrafficMonitorSettings,
    updateSettings: updateTrafficMonitorSettings,
    getInterfaceStats,
    getDeviceTraffic,
    getNetworkSummary,
    formatBytes,
};
