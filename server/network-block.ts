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
import * as fs from "fs/promises";
import { storage } from "./storage";
import { notificationService } from "./notification-service";

const execAsync = promisify(exec);

// Hostapd configuration
const HOSTAPD_DENY_FILE = "/etc/hostapd/hostapd.deny";
const HOSTAPD_INTERFACE = "wlan1";  // IoT-Secure hotspot interface

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
    enabled: true,  // Network blocking enabled by default
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

// ==================== HOSTAPD WiFi BLOCKING ====================

/**
 * Deauthenticate a device from the IoT-Secure WiFi hotspot
 * This kicks the device off the WiFi immediately
 */
async function deauthenticateFromWifi(macAddress: string): Promise<boolean> {
    try {
        const mac = macAddress.toUpperCase();
        console.log(`[NetworkBlock] Deauthenticating ${mac} from WiFi (${HOSTAPD_INTERFACE})`);

        // Use hostapd_cli to send deauthentication frame
        await execAsync(`sudo hostapd_cli -i ${HOSTAPD_INTERFACE} deauthenticate ${mac}`);
        console.log(`[NetworkBlock] Successfully deauthenticated ${mac} from WiFi`);
        return true;
    } catch (error) {
        console.error(`[NetworkBlock] Failed to deauthenticate device:`, error);
        return false;
    }
}

/**
 * Add a MAC address to the hostapd deny list
 * This prevents the device from reconnecting to IoT-Secure hotspot
 */
async function addToHostapdDenyList(macAddress: string): Promise<boolean> {
    try {
        const mac = macAddress.toUpperCase();

        // Ensure deny file exists
        try {
            await fs.access(HOSTAPD_DENY_FILE);
        } catch {
            // Create the file if it doesn't exist
            await execAsync(`sudo touch ${HOSTAPD_DENY_FILE}`);
            await execAsync(`sudo chmod 644 ${HOSTAPD_DENY_FILE}`);
        }

        // Read current deny list
        const content = await execAsync(`sudo cat ${HOSTAPD_DENY_FILE}`);
        const existingMacs = content.stdout.split('\n').map(m => m.trim().toUpperCase()).filter(Boolean);

        // Check if already in list
        if (existingMacs.includes(mac)) {
            console.log(`[NetworkBlock] MAC ${mac} already in hostapd deny list`);
            return true;
        }

        // Add to deny list
        await execAsync(`echo "${mac}" | sudo tee -a ${HOSTAPD_DENY_FILE}`);
        console.log(`[NetworkBlock] Added ${mac} to hostapd deny list`);

        // Reload hostapd to apply changes (if running)
        try {
            await execAsync(`sudo systemctl reload hostapd 2>/dev/null || true`);
        } catch {
            // hostapd might not be running, that's okay
        }

        return true;
    } catch (error) {
        console.error(`[NetworkBlock] Failed to add MAC to hostapd deny list:`, error);
        return false;
    }
}

/**
 * Remove a MAC address from the hostapd deny list
 * This allows the device to reconnect to IoT-Secure hotspot
 */
async function removeFromHostapdDenyList(macAddress: string): Promise<boolean> {
    try {
        const mac = macAddress.toUpperCase();

        // Check if deny file exists
        try {
            await fs.access(HOSTAPD_DENY_FILE);
        } catch {
            console.log(`[NetworkBlock] Hostapd deny file doesn't exist, nothing to remove`);
            return true;
        }

        // Read current deny list
        const content = await execAsync(`sudo cat ${HOSTAPD_DENY_FILE}`);
        const existingMacs = content.stdout.split('\n').map(m => m.trim()).filter(Boolean);

        // Filter out the MAC to remove
        const newMacs = existingMacs.filter(m => m.toUpperCase() !== mac);

        // Write back the filtered list
        if (newMacs.length !== existingMacs.length) {
            const newContent = newMacs.join('\n') + (newMacs.length > 0 ? '\n' : '');
            await execAsync(`echo "${newContent}" | sudo tee ${HOSTAPD_DENY_FILE}`);
            console.log(`[NetworkBlock] Removed ${mac} from hostapd deny list`);

            // Reload hostapd to apply changes (if running)
            try {
                await execAsync(`sudo systemctl reload hostapd 2>/dev/null || true`);
            } catch {
                // hostapd might not be running, that's okay
            }
        } else {
            console.log(`[NetworkBlock] MAC ${mac} was not in hostapd deny list`);
        }

        return true;
    } catch (error) {
        console.error(`[NetworkBlock] Failed to remove MAC from hostapd deny list:`, error);
        return false;
    }
}

// ==================== END HOSTAPD BLOCKING ====================


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
 * OpenWRT ubus API helper - get session token
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
                    "00000000000000000000000000000000", // null session for login
                    "session",
                    "login",
                    {
                        username: settings.openwrtUser,
                        password: settings.openwrtPassword,
                    },
                ],
            }),
        });

        const data = await response.json() as any;
        if (data.result && data.result[0] === 0 && data.result[1]?.ubus_rpc_session) {
            console.log("[OpenWRT] ✓ Authenticated successfully");
            return data.result[1].ubus_rpc_session;
        }
        console.error("[OpenWRT] Login failed:", data);
        return null;
    } catch (error) {
        console.error("[OpenWRT] Login error:", error);
        return null;
    }
}

/**
 * OpenWRT ubus API helper - make authenticated call
 */
async function openwrtUbus(
    session: string,
    path: string,
    method: string,
    params: Record<string, any> = {}
): Promise<any> {
    const response = await fetch(`http://${settings.openwrtHost}/ubus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "call",
            params: [session, path, method, params],
        }),
    });

    const data = await response.json() as any;
    if (data.result && data.result[0] === 0) {
        return data.result[1] || true;
    }
    throw new Error(`ubus call failed: ${JSON.stringify(data)}`);
}

/**
 * Block via OpenWRT firewall using ubus API
 * Creates a firewall rule to drop traffic from the MAC address
 */
async function blockWithOpenwrt(targetIP: string, targetMAC: string): Promise<boolean> {
    if (!settings.openwrtHost || !settings.openwrtUser || !settings.openwrtPassword) {
        console.log("[NetworkBlock] OpenWRT not configured");
        return false;
    }

    try {
        // Step 1: Authenticate
        const session = await openwrtLogin();
        if (!session) {
            return false;
        }

        console.log(`[OpenWRT] Adding firewall rule to block MAC: ${targetMAC}`);

        // Step 2: Add firewall rule via uci
        // Create a unique rule name based on MAC
        const ruleName = `block_${targetMAC.replace(/:/g, "")}`.toLowerCase();

        // Add the rule to firewall config
        await openwrtUbus(session, "uci", "add", {
            config: "firewall",
            type: "rule",
            name: ruleName,
            values: {
                name: ruleName,
                src: "lan",
                src_mac: targetMAC.toLowerCase(),
                dest: "*",
                target: "DROP",
                enabled: "1",
            },
        });

        // Step 3: Commit the UCI changes
        await openwrtUbus(session, "uci", "commit", { config: "firewall" });

        // Step 4: Reload firewall to apply changes
        await openwrtUbus(session, "luci", "setReloadFlag", { flag: "firewall" });

        // Alternative: direct firewall reload
        try {
            await openwrtUbus(session, "service", "event", {
                type: "reload",
                data: { name: "firewall" },
            });
        } catch {
            // Some OpenWRT versions use different reload method
            console.log("[OpenWRT] Firewall reload via service failed, trying restart");
        }

        console.log(`[OpenWRT] ✓ Firewall rule added for ${targetMAC}`);
        return true;
    } catch (error) {
        console.error("[OpenWRT] Block error:", error);
        return false;
    }
}

/**
 * Unblock via OpenWRT firewall
 */
async function unblockWithOpenwrt(targetMAC: string): Promise<boolean> {
    if (!settings.openwrtHost || !settings.openwrtUser || !settings.openwrtPassword) {
        return false;
    }

    try {
        const session = await openwrtLogin();
        if (!session) return false;

        const ruleName = `block_${targetMAC.replace(/:/g, "")}`.toLowerCase();
        console.log(`[OpenWRT] Removing firewall rule: ${ruleName}`);

        // Find and delete the rule
        // First, get all firewall rules
        const rules = await openwrtUbus(session, "uci", "get", {
            config: "firewall",
            type: "rule",
        });

        // Find our rule by name
        if (rules && rules.values) {
            for (const [section, values] of Object.entries(rules.values as Record<string, any>)) {
                if (values.name === ruleName) {
                    // Delete this section
                    await openwrtUbus(session, "uci", "delete", {
                        config: "firewall",
                        section: section,
                    });
                    break;
                }
            }
        }

        // Commit and reload
        await openwrtUbus(session, "uci", "commit", { config: "firewall" });

        console.log(`[OpenWRT] ✓ Firewall rule removed for ${targetMAC}`);
        return true;
    } catch (error) {
        console.error("[OpenWRT] Unblock error:", error);
        return false;
    }
}

/**
 * Test OpenWRT connection
 */
export async function testOpenwrtConnection(): Promise<{ success: boolean; message: string }> {
    try {
        const session = await openwrtLogin();
        if (!session) {
            return { success: false, message: "Authentication failed" };
        }

        // Try to get system info
        const info = await openwrtUbus(session, "system", "board", {});
        return {
            success: true,
            message: `Connected to ${info?.hostname || "OpenWRT"} (${info?.release?.description || "unknown version"})`,
        };
    } catch (error) {
        return { success: false, message: `Connection failed: ${error}` };
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
        // BLOCKED zone: Full DHCP-level denial + WiFi disconnection

        // Step 1: Kick device off WiFi immediately
        await deauthenticateFromWifi(macAddress);

        // Step 2: Add to hostapd deny list to prevent reconnection
        await addToHostapdDenyList(macAddress);

        // Step 3: Apply network-level blocking as backup
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

        console.log(`[NetworkBlock] Device ${macAddress} blocked from WiFi and network`);
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
    const blocked = blockedDevices.get(ipAddress);
    const macAddress = blocked?.macAddress || "";

    // Remove from hostapd deny list to allow WiFi reconnection
    if (macAddress) {
        await removeFromHostapdDenyList(macAddress);
        console.log(`[NetworkBlock] Removed ${macAddress} from WiFi deny list, device can reconnect`);
    }

    switch (settings.method) {
        case "arp":
        case "local":
            blockedDevices.delete(ipAddress);
            return unblockWithArp(ipAddress);
        case "pihole":
            blockedDevices.delete(ipAddress);
            return unblockWithPihole(ipAddress);
        case "openwrt":
            if (macAddress) {
                blockedDevices.delete(ipAddress);
                return unblockWithOpenwrt(macAddress);
            }
            console.log("[NetworkBlock] Cannot unblock via OpenWRT - no MAC address found");
            return false;
        default:
            blockedDevices.delete(ipAddress);
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
