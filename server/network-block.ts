/**
 * Network-Wide Blocking Service
 * 
 * Implements ARP-based blocking to prevent blocked devices from communicating
 * on the network. Works by sending fake ARP replies to make the device think
 * the gateway is unreachable.
 * 
 * Methods supported:
 * 1. ARP Spoofing (default) - Works with any router
 * 2. Pi-hole integration - DNS-level blocking
 * 3. OpenWRT API - Direct firewall rules (for OpenWRT users)
 */

import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";
import { notificationService } from "./notification-service";

const execAsync = promisify(exec);

export type BlockingMethod = "arp" | "pihole" | "openwrt" | "local";

export interface NetworkBlockSettings {
    enabled: boolean;
    method: BlockingMethod;
    // OpenWRT settings
    openwrtHost?: string;
    openwrtUser?: string;
    openwrtPassword?: string;
    // Pi-hole settings
    piholeHost?: string;
    piholeApiKey?: string;
}

interface BlockedDevice {
    deviceId: number;
    ipAddress: string;
    macAddress: string;
    reason: string;
    blockedAt: Date;
    arpProcess?: ChildProcess;
}

let settings: NetworkBlockSettings = {
    enabled: false,
    method: "arp",
};

const blockedDevices = new Map<string, BlockedDevice>();

/**
 * Get router IP (default gateway)
 */
async function getGatewayIP(): Promise<string | null> {
    try {
        const { stdout } = await execAsync("ip route | grep default | awk '{print $3}'");
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Get our interface name
 */
async function getInterfaceName(): Promise<string | null> {
    try {
        const { stdout } = await execAsync("ip route | grep default | awk '{print $5}'");
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Get our MAC address
 */
async function getOurMac(iface: string): Promise<string | null> {
    try {
        const { stdout } = await execAsync(`cat /sys/class/net/${iface}/address`);
        return stdout.trim().toUpperCase() || null;
    } catch {
        return null;
    }
}

/**
 * Block a device using ARP poisoning
 * This tells the target device that OUR MAC is the gateway,
 * but we don't forward their traffic - effectively blocking them.
 */
async function blockWithArp(
    targetIP: string,
    targetMAC: string,
    reason: string
): Promise<boolean> {
    try {
        const gateway = await getGatewayIP();
        const iface = await getInterfaceName();
        const ourMac = iface ? await getOurMac(iface) : null;

        if (!gateway || !iface || !ourMac) {
            console.error("[NetworkBlock] Could not get gateway/interface info");
            return false;
        }

        console.log(`[NetworkBlock] Blocking ${targetIP} via ARP (gateway: ${gateway}, iface: ${iface})`);

        // Method 1: Use arping to send fake ARP replies
        // This tells the target that the gateway MAC is our MAC
        // arping -U -s <gateway_ip> -S <our_mac> <target_ip>

        // Method 2: Continuously poison the target's ARP cache
        // We'll spawn a process that sends ARP replies periodically

        // First, add a static ARP entry on the target (if we have access)
        // Since we don't, we'll use gratuitous ARP

        // Use ip neigh to add a static entry for monitoring
        await execAsync(
            `sudo ip neigh replace ${gateway} lladdr ${ourMac} dev ${iface} nud permanent 2>/dev/null || true`
        );

        // For actual blocking, we need to continuously send ARP replies
        // This requires arping or arpspoof to be installed
        // Let's check if arping is available
        try {
            await execAsync("which arping");

            // Spawn arping process to continuously poison
            const arpProcess = spawn("sudo", [
                "arping",
                "-U",                    // Unsolicited ARP
                "-q",                    // Quiet
                "-c", "0",               // Infinite count
                "-I", iface,
                "-s", gateway,           // Source IP (pretend to be gateway)
                targetIP                 // Target
            ], { detached: true });

            arpProcess.on("error", (err) => {
                console.error("[NetworkBlock] arping error:", err);
            });

            // Store the process for later cleanup
            const blockEntry: BlockedDevice = {
                deviceId: 0,
                ipAddress: targetIP,
                macAddress: targetMAC,
                reason,
                blockedAt: new Date(),
                arpProcess,
            };
            blockedDevices.set(targetIP, blockEntry);

            console.log(`[NetworkBlock] ✓ Started ARP poisoning for ${targetIP}`);
            return true;
        } catch {
            console.log("[NetworkBlock] arping not found, using nftables fallback");

            // Fallback: Use nftables to block at the Pi level
            // This is less effective but works without additional tools
            await execAsync(
                `sudo nft add rule inet filter forward ip saddr ${targetIP} drop 2>/dev/null || true`
            );

            const blockEntry: BlockedDevice = {
                deviceId: 0,
                ipAddress: targetIP,
                macAddress: targetMAC,
                reason,
                blockedAt: new Date(),
            };
            blockedDevices.set(targetIP, blockEntry);

            return true;
        }
    } catch (error) {
        console.error("[NetworkBlock] Error blocking device:", error);
        return false;
    }
}

/**
 * Unblock a device
 */
async function unblockWithArp(targetIP: string): Promise<boolean> {
    try {
        const blockEntry = blockedDevices.get(targetIP);

        if (blockEntry?.arpProcess) {
            // Kill the ARP poisoning process
            blockEntry.arpProcess.kill("SIGTERM");
        }

        // Remove nftables rule if it exists
        await execAsync(
            `sudo nft delete rule inet filter forward handle $(sudo nft -a list chain inet filter forward 2>/dev/null | grep "ip saddr ${targetIP} drop" | awk '{print $NF}') 2>/dev/null || true`
        );

        blockedDevices.delete(targetIP);
        console.log(`[NetworkBlock] ✓ Unblocked ${targetIP}`);
        return true;
    } catch (error) {
        console.error("[NetworkBlock] Error unblocking device:", error);
        return false;
    }
}

/**
 * Block via Pi-hole (if configured)
 */
async function blockWithPihole(targetIP: string): Promise<boolean> {
    if (!settings.piholeHost || !settings.piholeApiKey) {
        console.log("[NetworkBlock] Pi-hole not configured");
        return false;
    }

    try {
        // Pi-hole API to add a client to the blocklist
        const response = await fetch(
            `http://${settings.piholeHost}/admin/api.php?list=black&add=${targetIP}&auth=${settings.piholeApiKey}`
        );
        return response.ok;
    } catch (error) {
        console.error("[NetworkBlock] Pi-hole error:", error);
        return false;
    }
}

/**
 * Block via OpenWRT firewall
 */
async function blockWithOpenwrt(targetIP: string, targetMAC: string): Promise<boolean> {
    if (!settings.openwrtHost || !settings.openwrtUser || !settings.openwrtPassword) {
        console.log("[NetworkBlock] OpenWRT not configured");
        return false;
    }

    try {
        // OpenWRT LuCI RPC or ubus API call
        // This is a simplified implementation - real one would use ubus
        const response = await fetch(
            `http://${settings.openwrtHost}/cgi-bin/luci/admin/network/firewall/rules`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${Buffer.from(`${settings.openwrtUser}:${settings.openwrtPassword}`).toString("base64")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "drop",
                    src_mac: targetMAC,
                    name: `Block-${targetMAC.replace(/:/g, "")}`,
                }),
            }
        );
        return response.ok;
    } catch (error) {
        console.error("[NetworkBlock] OpenWRT error:", error);
        return false;
    }
}

// ==================== Public API ====================

export function getNetworkBlockSettings(): NetworkBlockSettings {
    return { ...settings };
}

export function updateNetworkBlockSettings(updates: Partial<NetworkBlockSettings>): NetworkBlockSettings {
    settings = { ...settings, ...updates };
    console.log("[NetworkBlock] Settings updated:", settings);
    return settings;
}

export async function blockDevice(
    deviceId: number,
    ipAddress: string,
    macAddress: string,
    reason: string
): Promise<boolean> {
    if (!settings.enabled) {
        console.log("[NetworkBlock] Blocking disabled");
        return false;
    }

    let success = false;

    switch (settings.method) {
        case "arp":
            success = await blockWithArp(ipAddress, macAddress, reason);
            break;
        case "pihole":
            success = await blockWithPihole(ipAddress);
            break;
        case "openwrt":
            success = await blockWithOpenwrt(ipAddress, macAddress);
            break;
        case "local":
            // Local only - just nftables on this Pi
            await execAsync(`sudo nft add rule inet filter input ip saddr ${ipAddress} drop 2>/dev/null || true`);
            success = true;
            break;
    }

    if (success) {
        await notificationService.notifyAutoBlocked(
            `Device ${ipAddress}`,
            reason,
            deviceId
        );
    }

    return success;
}

export async function unblockDevice(ipAddress: string): Promise<boolean> {
    switch (settings.method) {
        case "arp":
            return unblockWithArp(ipAddress);
        default:
            // Remove nftables rule
            await execAsync(
                `sudo nft delete rule inet filter input handle $(sudo nft -a list ruleset 2>/dev/null | grep "ip saddr ${ipAddress} drop" | awk '{print $NF}') 2>/dev/null || true`
            );
            return true;
    }
}

export function getBlockedDevices(): BlockedDevice[] {
    return Array.from(blockedDevices.values()).map(({ arpProcess, ...rest }) => rest);
}

export async function checkDependencies(): Promise<{
    arping: boolean;
    nft: boolean;
    gateway: string | null;
    interface: string | null;
}> {
    let arping = false;
    let nft = false;

    try {
        await execAsync("which arping");
        arping = true;
    } catch { }

    try {
        await execAsync("which nft");
        nft = true;
    } catch { }

    const gateway = await getGatewayIP();
    const iface = await getInterfaceName();

    return { arping, nft, gateway, interface: iface };
}

export const networkBlockService = {
    getSettings: getNetworkBlockSettings,
    updateSettings: updateNetworkBlockSettings,
    blockDevice,
    unblockDevice,
    getBlockedDevices,
    checkDependencies,
};
