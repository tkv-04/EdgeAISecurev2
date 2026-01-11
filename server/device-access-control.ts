import { exec } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";

const execAsync = promisify(exec);

// Chain name for device access control
const DEVICE_CHAIN = "DEVICE_ACCESS";

// Statuses that allow network access
const ALLOWED_STATUSES = ["approved", "active", "monitoring", "learning"];

/**
 * Initialize the device access control system
 * Sets up iptables rules for default-deny with approved device exceptions
 */
export async function initAccessControl(): Promise<void> {
    console.log("[DeviceAccessControl] Initializing...");

    try {
        // Create custom chain if it doesn't exist
        await execAsync(`sudo iptables -N ${DEVICE_CHAIN} 2>/dev/null || true`);

        // Flush existing rules in our chain
        await execAsync(`sudo iptables -F ${DEVICE_CHAIN}`);

        // Remove existing jump to our chain and re-add at top
        await execAsync(`sudo iptables -D FORWARD -j ${DEVICE_CHAIN} 2>/dev/null || true`);
        await execAsync(`sudo iptables -I FORWARD 1 -j ${DEVICE_CHAIN}`);

        // === DEVICE_ACCESS Chain Rules ===

        // 1. Allow established/related connections (return traffic)
        await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -m state --state ESTABLISHED,RELATED -j RETURN`);

        // 2. Allow Pi's own traffic (by source/dest IP)
        const piIp = await getPiIp();
        if (piIp) {
            await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -s ${piIp} -j RETURN`);
            await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -d ${piIp} -j RETURN`);
        }

        // 3. Allow DHCP (so new devices can get IP)
        await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -p udp --dport 67:68 -j RETURN`);

        // 4. Allow ARP is handled at layer 2, not filtered by iptables
        // 5. Allow ICMP for network diagnostics (ping)
        await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -p icmp -j RETURN`);

        // 6. Sync approved devices from database
        await syncApprovedDevices();

        // 7. Final rule: DROP everything else
        await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -j DROP`);

        console.log("[DeviceAccessControl] Initialized successfully");
    } catch (error) {
        console.error("[DeviceAccessControl] Failed to initialize:", error);
    }
}

/**
 * Get Pi's IP address on eth0
 */
async function getPiIp(): Promise<string | null> {
    try {
        const { stdout } = await execAsync("ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -d/ -f1");
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Sync all approved devices from database to iptables
 */
export async function syncApprovedDevices(): Promise<void> {
    console.log("[DeviceAccessControl] Syncing approved devices...");

    try {
        const devices = await storage.getDevices();
        let allowedCount = 0;

        for (const device of devices) {
            if (ALLOWED_STATUSES.includes(device.status)) {
                await allowDeviceByMac(device.macAddress, false);
                allowedCount++;
            }
        }

        console.log(`[DeviceAccessControl] Synced ${allowedCount} approved devices`);
    } catch (error) {
        console.error("[DeviceAccessControl] Sync failed:", error);
    }
}

/**
 * Allow a device by MAC address
 */
export async function allowDeviceByMac(mac: string, log: boolean = true): Promise<boolean> {
    const normalizedMac = mac.toUpperCase();

    try {
        // Check if rule already exists
        const { stdout } = await execAsync(`sudo iptables -L ${DEVICE_CHAIN} -n | grep -i "${normalizedMac}" || true`);

        if (!stdout.includes(normalizedMac)) {
            // Insert before the final DROP rule (at position -2 from end)
            // Use -I with position to insert before DROP
            const { stdout: lineCount } = await execAsync(`sudo iptables -L ${DEVICE_CHAIN} --line-numbers | tail -1 | awk '{print $1}'`);
            const dropLine = parseInt(lineCount.trim()) || 1;

            await execAsync(`sudo iptables -I ${DEVICE_CHAIN} ${dropLine} -m mac --mac-source ${normalizedMac} -j RETURN`);

            if (log) {
                console.log(`[DeviceAccessControl] Allowed device: ${normalizedMac}`);
            }
        }

        return true;
    } catch (error) {
        console.error(`[DeviceAccessControl] Failed to allow device ${normalizedMac}:`, error);
        return false;
    }
}

/**
 * Block a device by MAC address (remove from allowed list)
 */
export async function blockDeviceByMac(mac: string): Promise<boolean> {
    const normalizedMac = mac.toUpperCase();

    try {
        // Remove ALL occurrences of the MAC rule (might have duplicates)
        let removed = 0;
        for (let i = 0; i < 10; i++) {
            try {
                await execAsync(`sudo iptables -D ${DEVICE_CHAIN} -m mac --mac-source ${normalizedMac} -j RETURN 2>/dev/null`);
                removed++;
            } catch {
                break; // No more rules to delete
            }
        }

        // Also try to kill existing connections for this device
        // First, get IP from ARP table for this MAC
        try {
            const { stdout } = await execAsync(`ip neigh | grep -i "${normalizedMac}" | awk '{print $1}'`);
            const ip = stdout.trim();
            if (ip) {
                // Flush connection tracking for this IP to kill existing connections
                await execAsync(`sudo conntrack -D -s ${ip} 2>/dev/null || true`);
                await execAsync(`sudo conntrack -D -d ${ip} 2>/dev/null || true`);
            }
        } catch {
            // conntrack might not be installed, ignore
        }

        console.log(`[DeviceAccessControl] Blocked device: ${normalizedMac} (removed ${removed} rules)`);
        return true;
    } catch (error) {
        console.error(`[DeviceAccessControl] Failed to block device ${normalizedMac}:`, error);
        return false;
    }
}

/**
 * Update device access based on status change
 */
export async function updateDeviceAccess(mac: string, status: string): Promise<void> {
    if (ALLOWED_STATUSES.includes(status)) {
        await allowDeviceByMac(mac);
    } else {
        await blockDeviceByMac(mac);
    }
}

/**
 * Get current access control status
 */
export async function getAccessControlStatus(): Promise<{
    enabled: boolean;
    allowedDevices: number;
    rules: string[];
}> {
    try {
        const { stdout } = await execAsync(`sudo iptables -L ${DEVICE_CHAIN} -n --line-numbers 2>/dev/null || echo ""`);
        const lines = stdout.trim().split("\n").filter(l => l.trim());

        // Count MAC rules
        const macRules = lines.filter(l => l.includes("MAC"));

        return {
            enabled: lines.length > 0,
            allowedDevices: macRules.length,
            rules: lines.slice(2), // Skip header lines
        };
    } catch {
        return { enabled: false, allowedDevices: 0, rules: [] };
    }
}

/**
 * Save rules to persist across reboot
 */
export async function saveAccessControlRules(): Promise<boolean> {
    try {
        await execAsync("sudo netfilter-persistent save");
        console.log("[DeviceAccessControl] Rules saved for persistence");
        return true;
    } catch (error) {
        console.error("[DeviceAccessControl] Failed to save rules:", error);
        return false;
    }
}

/**
 * Disable access control (allow all)
 */
export async function disableAccessControl(): Promise<void> {
    try {
        await execAsync(`sudo iptables -F ${DEVICE_CHAIN}`);
        await execAsync(`sudo iptables -A ${DEVICE_CHAIN} -j RETURN`);
        console.log("[DeviceAccessControl] Disabled - all traffic allowed");
    } catch (error) {
        console.error("[DeviceAccessControl] Failed to disable:", error);
    }
}
