import { exec } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";
import { notificationService } from "./notification-service";
import { getMacVendor } from "./network-scanner";

const execAsync = promisify(exec);

export interface AutoBlockSettings {
    enabled: boolean;
    blockUnknownVendors: boolean;
    blockSuspiciousPorts: boolean;
    suspiciousPorts: number[];
    whitelist: string[]; // MAC addresses that should never be blocked
}

let settings: AutoBlockSettings = {
    enabled: false,
    blockUnknownVendors: false,
    blockSuspiciousPorts: false,
    suspiciousPorts: [23, 2323, 5555], // Telnet, alternative Telnet, ADB
    whitelist: [],
};

/**
 * Get current auto-block settings
 */
export function getAutoBlockSettings(): AutoBlockSettings {
    return { ...settings };
}

/**
 * Update auto-block settings
 */
export function updateAutoBlockSettings(
    updates: Partial<AutoBlockSettings>
): AutoBlockSettings {
    settings = { ...settings, ...updates };
    console.log("[AutoBlock] Settings updated:", settings);
    return settings;
}

/**
 * Check if a device should be auto-blocked
 */
export function shouldAutoBlock(
    macAddress: string,
    openPorts: number[] = []
): { block: boolean; reason: string | null } {
    if (!settings.enabled) {
        return { block: false, reason: null };
    }

    // Check whitelist
    if (settings.whitelist.includes(macAddress.toUpperCase())) {
        return { block: false, reason: null };
    }

    // Check for unknown vendor
    if (settings.blockUnknownVendors) {
        const vendor = getMacVendor(macAddress);
        if (!vendor) {
            return { block: true, reason: "Unknown MAC vendor" };
        }
    }

    // Check for suspicious ports
    if (settings.blockSuspiciousPorts && openPorts.length > 0) {
        for (const port of openPorts) {
            if (settings.suspiciousPorts.includes(port)) {
                return { block: true, reason: `Suspicious port detected: ${port}` };
            }
        }
    }

    return { block: false, reason: null };
}

/**
 * Block a device using nftables
 */
export async function blockDevice(
    ipAddress: string,
    macAddress: string,
    reason: string
): Promise<boolean> {
    try {
        // First, check if nft is available
        await execAsync("which nft");

        // Create a rule to drop traffic from this IP
        // Using nft (nftables) - requires sudo
        const command = `sudo nft add rule inet filter input ip saddr ${ipAddress} drop 2>/dev/null || echo "Rule may already exist or nft not configured"`;

        console.log(`[AutoBlock] Blocking device: ${ipAddress} (${macAddress}) - ${reason}`);

        const { stdout, stderr } = await execAsync(command);

        if (stderr && !stderr.includes("Rule may already exist")) {
            console.error("[AutoBlock] Error blocking device:", stderr);
            return false;
        }

        // Log the action
        console.log(`[AutoBlock] ✓ Device blocked: ${ipAddress}`);
        return true;
    } catch (error) {
        console.error("[AutoBlock] Failed to block device:", error);
        return false;
    }
}

/**
 * Unblock a device
 */
export async function unblockDevice(ipAddress: string): Promise<boolean> {
    try {
        // Remove the block rule
        const command = `sudo nft delete rule inet filter input handle $(sudo nft -a list ruleset | grep "ip saddr ${ipAddress} drop" | awk '{print $NF}') 2>/dev/null || echo "Rule not found or nft not configured"`;

        console.log(`[AutoBlock] Unblocking device: ${ipAddress}`);
        await execAsync(command);
        return true;
    } catch (error) {
        console.error("[AutoBlock] Failed to unblock device:", error);
        return false;
    }
}

/**
 * Process a newly discovered device for auto-blocking
 */
export async function processNewDevice(
    deviceId: number,
    deviceName: string,
    macAddress: string,
    ipAddress: string,
    openPorts: number[] = []
): Promise<void> {
    const { block, reason } = shouldAutoBlock(macAddress, openPorts);

    if (block && reason) {
        console.log(`[AutoBlock] Auto-blocking ${deviceName}: ${reason}`);

        // Try to block the device
        const blocked = await blockDevice(ipAddress, macAddress, reason);

        if (blocked) {
            // Update device status to blocked
            // Note: We'd need to add an updateDeviceStatus method to storage

            // Send notification
            await notificationService.notifyAutoBlocked(deviceName, reason, deviceId);
        }
    }
}

/**
 * List currently blocked IPs (from nftables)
 */
export async function listBlockedIPs(): Promise<string[]> {
    try {
        const { stdout } = await execAsync(
            'sudo nft list ruleset 2>/dev/null | grep "ip saddr" | grep "drop" || true'
        );

        const lines = stdout.trim().split("\n").filter(Boolean);
        const ips = lines.map((line) => {
            const match = line.match(/ip saddr (\d+\.\d+\.\d+\.\d+)/);
            return match ? match[1] : null;
        }).filter(Boolean) as string[];

        return ips;
    } catch {
        return [];
    }
}

export const autoBlockService = {
    getSettings: getAutoBlockSettings,
    updateSettings: updateAutoBlockSettings,
    shouldAutoBlock,
    blockDevice,
    unblockDevice,
    processNewDevice,
    listBlockedIPs,
};
