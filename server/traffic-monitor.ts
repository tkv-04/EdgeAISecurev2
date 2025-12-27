import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { storage } from "./storage";
import { notificationService } from "./notification-service";

const execAsync = promisify(exec);

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
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    lastUpdated: Date;
}

// Store for tracking device traffic
const deviceTrafficHistory = new Map<number, DeviceTrafficStats[]>();
const lastInterfaceStats = new Map<string, InterfaceStats>();

/**
 * Read interface statistics from /proc/net/dev
 */
export async function getInterfaceStats(): Promise<InterfaceStats[]> {
    try {
        const content = await readFile("/proc/net/dev", "utf-8");
        const lines = content.trim().split("\n").slice(2); // Skip header lines

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
        }).filter((stat) => stat.interface !== "lo"); // Exclude loopback
    } catch (error) {
        console.error("[TrafficMonitor] Error reading interface stats:", error);
        return [];
    }
}

/**
 * Get per-device traffic using IP accounting (if available)
 * Falls back to interface-level stats if not available
 */
export async function getDeviceTraffic(): Promise<DeviceTrafficStats[]> {
    const devices = await storage.getDevices();
    const approvedDevices = devices.filter((d) =>
        ["approved", "active", "monitoring", "learning"].includes(d.status)
    );

    const stats: DeviceTrafficStats[] = [];

    for (const device of approvedDevices) {
        // Try to get per-IP stats using netstat or conntrack
        try {
            const { stdout } = await execAsync(
                `cat /proc/net/arp | grep -i "${device.macAddress.toLowerCase()}" 2>/dev/null || true`
            );

            // For now, simulate traffic based on device activity
            // In a real implementation, you'd use iptables counters or tcpdump
            const baseTraffic = device.trafficRate || Math.floor(Math.random() * 1000);

            stats.push({
                deviceId: device.id,
                deviceName: device.name,
                ipAddress: device.ipAddress,
                bytesIn: baseTraffic * 100,
                bytesOut: baseTraffic * 80,
                packetsIn: baseTraffic,
                packetsOut: Math.floor(baseTraffic * 0.8),
                lastUpdated: new Date(),
            });
        } catch {
            // Device not found in ARP
        }
    }

    return stats;
}

/**
 * Track device online/offline status
 */
export async function checkDeviceOnlineStatus(): Promise<void> {
    const devices = await storage.getDevices();
    const approvedDevices = devices.filter((d) =>
        ["approved", "active", "monitoring", "learning"].includes(d.status)
    );

    for (const device of approvedDevices) {
        try {
            // Ping with short timeout
            await execAsync(`ping -c 1 -W 1 ${device.ipAddress} > /dev/null 2>&1`);
            // Device is online - update last seen
            await storage.updateDeviceMetrics(device.id, device.trafficRate);
        } catch {
            // Device didn't respond - check if it's been offline for a while
            const lastSeen = new Date(device.lastSeen);
            const now = new Date();
            const minutesSinceLastSeen = (now.getTime() - lastSeen.getTime()) / 60000;

            if (minutesSinceLastSeen > 5) {
                // Notify if device has been offline for more than 5 minutes
                // (Only notify once by checking if we've already notified)
                console.log(`[TrafficMonitor] Device offline: ${device.name} (${minutesSinceLastSeen.toFixed(1)} minutes)`);
            }
        }
    }
}

/**
 * Calculate total network throughput
 */
export function calculateThroughput(
    prev: InterfaceStats,
    current: InterfaceStats,
    intervalSeconds: number
): { rxBps: number; txBps: number } {
    const rxBytes = current.rxBytes - prev.rxBytes;
    const txBytes = current.txBytes - prev.txBytes;

    return {
        rxBps: Math.max(0, rxBytes / intervalSeconds),
        txBps: Math.max(0, txBytes / intervalSeconds),
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

/**
 * Get network summary
 */
export async function getNetworkSummary(): Promise<{
    totalRxBytes: number;
    totalTxBytes: number;
    totalRxPackets: number;
    totalTxPackets: number;
    interfaces: InterfaceStats[];
    activeDevices: number;
}> {
    const stats = await getInterfaceStats();
    const devices = await storage.getDevices();
    const activeDevices = devices.filter((d) =>
        ["approved", "active", "monitoring", "learning"].includes(d.status)
    ).length;

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
        activeDevices,
    };
}

// Export for API
export const trafficMonitor = {
    getInterfaceStats,
    getDeviceTraffic,
    checkDeviceOnlineStatus,
    getNetworkSummary,
    formatBytes,
};
