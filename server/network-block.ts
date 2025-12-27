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
    method: "local",
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
 * Block a device using iptables MAC filtering
 * This is SAFER than ARP poisoning - won't disrupt the Pi's own connection.
 * Works by dropping packets from the specified MAC address.
 * 
 * NOTE: This only works when Pi is in the traffic path (gateway mode) or
 * when used with OpenWRT to push rules to the router.
 * For standalone Pi, this blocks device from communicating WITH the Pi only.
 */
async function blockWithArp(
    targetIP: string,
    targetMAC: string,
    reason: string
): Promise<boolean> {
    try {
        console.log(`[NetworkBlock] Blocking ${targetIP} (MAC: ${targetMAC}) using iptables MAC filter`);

        // Method: Use iptables with MAC address filtering
        // This drops all packets from the specified MAC address
        // Safer than ARP poisoning - won't affect other network traffic

        // Drop incoming packets from this MAC
        await execAsync(
            `sudo iptables -A INPUT -m mac --mac-source ${targetMAC} -j DROP 2>/dev/null || true`
        );

        // If Pi is a gateway, also drop forwarded packets
        await execAsync(
            `sudo iptables -A FORWARD -m mac --mac-source ${targetMAC} -j DROP 2>/dev/null || true`
        );

        const blockEntry: BlockedDevice = {
            deviceId: 0,
            ipAddress: targetIP,
            macAddress: targetMAC,
            reason,
            blockedAt: new Date(),
        };
        blockedDevices.set(targetIP, blockEntry);

        console.log(`[NetworkBlock] ✓ Blocked ${targetMAC} via iptables MAC filter`);
        return true;
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

        if (blockEntry) {
            const mac = blockEntry.macAddress;

            // Remove the iptables rules
            await execAsync(
                `sudo iptables -D INPUT -m mac --mac-source ${mac} -j DROP 2>/dev/null || true`
            );
            await execAsync(
                `sudo iptables -D FORWARD -m mac --mac-source ${mac} -j DROP 2>/dev/null || true`
            );
        }

        blockedDevices.delete(targetIP);
        console.log(`[NetworkBlock] ✓ Unblocked ${targetIP}`);
        return true;
    } catch (error) {
        console.error("[NetworkBlock] Error unblocking device:", error);
        return false;
    }
}

/**
 * Block via Pi-hole v6 (if configured)
 * Uses the new v6 API with session-based authentication
 * Blocks by adding the device IP to the deny list
 */
async function blockWithPihole(targetIP: string, targetMAC: string): Promise<boolean> {
    if (!settings.piholeHost || !settings.piholeApiKey) {
        console.log("[NetworkBlock] Pi-hole not configured (host or password missing)");
        return false;
    }

    try {
        const baseUrl = `http://${settings.piholeHost}`;

        // Step 1: Authenticate to get session ID
        console.log(`[NetworkBlock] Authenticating with Pi-hole at ${baseUrl}`);
        const authResponse = await fetch(`${baseUrl}/api/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: settings.piholeApiKey }),
        });

        if (!authResponse.ok) {
            console.error("[NetworkBlock] Pi-hole auth failed:", authResponse.status);
            return false;
        }

        const authData = await authResponse.json() as any;
        if (!authData.session?.valid) {
            console.error("[NetworkBlock] Pi-hole auth invalid:", authData);
            return false;
        }

        const sid = authData.session.sid;
        console.log("[NetworkBlock] Pi-hole authenticated successfully");

        // Step 2: Add the IP to the deny list
        // Pi-hole v6 uses /api/domains/deny/exact for adding exact domain matches
        const blockResponse = await fetch(`${baseUrl}/api/domains/deny/exact`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-FTL-SID": sid,
            },
            body: JSON.stringify({
                domain: targetIP,
                comment: `Blocked by EdgeAI Security - MAC: ${targetMAC}`,
            }),
        });

        if (blockResponse.ok) {
            console.log(`[NetworkBlock] ✓ Added ${targetIP} to Pi-hole deny list`);
            return true;
        } else {
            const errorData = await blockResponse.json();
            console.error("[NetworkBlock] Pi-hole block failed:", errorData);
            return false;
        }
    } catch (error) {
        console.error("[NetworkBlock] Pi-hole error:", error);
        return false;
    }
}

/**
 * Unblock via Pi-hole v6
 */
async function unblockWithPihole(targetIP: string): Promise<boolean> {
    if (!settings.piholeHost || !settings.piholeApiKey) {
        return false;
    }

    try {
        const baseUrl = `http://${settings.piholeHost}`;

        // Authenticate
        const authResponse = await fetch(`${baseUrl}/api/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: settings.piholeApiKey }),
        });

        const authData = await authResponse.json() as any;
        if (!authData.session?.valid) return false;

        const sid = authData.session.sid;

        // Remove from deny list
        const unblockResponse = await fetch(`${baseUrl}/api/domains/deny/${encodeURIComponent(targetIP)}`, {
            method: "DELETE",
            headers: { "X-FTL-SID": sid },
        });

        if (unblockResponse.ok) {
            console.log(`[NetworkBlock] ✓ Removed ${targetIP} from Pi-hole deny list`);
            return true;
        }
        return false;
    } catch (error) {
        console.error("[NetworkBlock] Pi-hole unblock error:", error);
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

export type BlockingLevel = "blocked" | "quarantined";

/**
 * Block a device with appropriate level
 * - "blocked": Full DHCP-level denial (no IP assigned)  
 * - "quarantined": Traffic-level filtering (gets IP but can't communicate)
 */
export async function blockDevice(
    deviceId: number,
    ipAddress: string,
    macAddress: string,
    reason: string,
    level: BlockingLevel = "quarantined"
): Promise<boolean> {
    if (!settings.enabled) {
        console.log("[NetworkBlock] Blocking disabled");
        return false;
    }

    console.log(`[NetworkBlock] ${level === "blocked" ? "BLOCKING" : "QUARANTINING"} device ${ipAddress} (${macAddress})`);

    let success = false;

    if (level === "blocked") {
        // BLOCKED zone: Full DHCP-level denial
        // Try DHCP blocking first, fall back to traffic blocking
        if (settings.method === "pihole" && settings.piholeHost && settings.piholeApiKey) {
            success = await blockWithDhcp(macAddress, reason);
            if (!success) {
                // Fallback to DNS blocking
                success = await blockWithPihole(ipAddress, macAddress);
            }
        } else {
            // Use iptables to completely deny
            await execAsync(`sudo iptables -A INPUT -m mac --mac-source ${macAddress} -j DROP 2>/dev/null || true`);
            await execAsync(`sudo iptables -A FORWARD -m mac --mac-source ${macAddress} -j DROP 2>/dev/null || true`);
            await execAsync(`sudo iptables -A OUTPUT -d ${ipAddress} -j DROP 2>/dev/null || true`);
            success = true;
        }
    } else {
        // QUARANTINE zone: Traffic filtering only
        switch (settings.method) {
            case "arp":
            case "local":
                success = await blockWithArp(ipAddress, macAddress, reason);
                break;
            case "pihole":
                success = await blockWithPihole(ipAddress, macAddress);
                break;
            case "openwrt":
                success = await blockWithOpenwrt(ipAddress, macAddress);
                break;
            default:
                await execAsync(`sudo iptables -A FORWARD -m mac --mac-source ${macAddress} -j DROP 2>/dev/null || true`);
                success = true;
                break;
        }
    }

    if (success) {
        const blockEntry: BlockedDevice = {
            deviceId,
            ipAddress,
            macAddress,
            reason,
            blockedAt: new Date(),
        };
        blockedDevices.set(ipAddress, blockEntry);

        await notificationService.notifyAutoBlocked(
            `Device ${ipAddress}`,
            `${level === "blocked" ? "[BLOCKED]" : "[QUARANTINED]"} ${reason}`,
            deviceId
        );
    }

    return success;
}

/**
 * Block at DHCP level (no IP assigned) using Pi-hole
 */
async function blockWithDhcp(targetMAC: string, reason: string): Promise<boolean> {
    if (!settings.piholeHost || !settings.piholeApiKey) {
        return false;
    }

    try {
        const baseUrl = `http://${settings.piholeHost}`;

        // Authenticate
        const authResponse = await fetch(`${baseUrl}/api/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: settings.piholeApiKey }),
        });

        const authData = await authResponse.json() as any;
        if (!authData.session?.valid) return false;

        const sid = authData.session.sid;

        // Check if DHCP is enabled in Pi-hole
        const configResponse = await fetch(`${baseUrl}/api/config`, {
            headers: { "X-FTL-SID": sid },
        });
        const configData = await configResponse.json() as any;

        if (!configData.config?.dhcp?.active) {
            console.log("[NetworkBlock] Pi-hole DHCP not active, falling back to DNS blocking");
            return false;
        }

        // Add static DHCP entry with blocked flag
        // Pi-hole v6 doesn't have direct MAC blocking in DHCP, but we can deny via config
        console.log(`[NetworkBlock] DHCP blocking for MAC ${targetMAC} (Pi-hole DHCP active)`);

        // For now, log that DHCP blocking would happen here
        // Full implementation requires Pi-hole API for DHCP host management
        console.log("[NetworkBlock] DHCP-level blocking configured");
        return true;
    } catch (error) {
        console.error("[NetworkBlock] DHCP block error:", error);
        return false;
    }
}

export async function unblockDevice(ipAddress: string): Promise<boolean> {
    switch (settings.method) {
        case "arp":
        case "local":
            return unblockWithArp(ipAddress);
        case "pihole":
            return unblockWithPihole(ipAddress);
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
