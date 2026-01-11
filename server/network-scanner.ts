import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { createConnection, Socket } from "net";

const execAsync = promisify(exec);

/**
 * Common IoT ports and their associated services/device types
 */
export const IOT_PORTS: Record<number, { service: string; iotType: string }> = {
    80: { service: "HTTP", iotType: "Web-enabled" },
    443: { service: "HTTPS", iotType: "Web-enabled" },
    1883: { service: "MQTT", iotType: "IoT Sensor" },
    8883: { service: "MQTT-TLS", iotType: "IoT Sensor" },
    5683: { service: "CoAP", iotType: "IoT Sensor" },
    5684: { service: "CoAP-DTLS", iotType: "IoT Sensor" },
    8080: { service: "HTTP-Alt", iotType: "Web-enabled" },
    8443: { service: "HTTPS-Alt", iotType: "Web-enabled" },
    22: { service: "SSH", iotType: "Linux Device" },
    23: { service: "Telnet", iotType: "Legacy Device" },
    554: { service: "RTSP", iotType: "Camera" },
    8554: { service: "RTSP-Alt", iotType: "Camera" },
    5000: { service: "UPnP", iotType: "Smart Device" },
    9100: { service: "Printer", iotType: "Printer" },
    631: { service: "IPP", iotType: "Printer" },
    548: { service: "AFP", iotType: "NAS" },
    445: { service: "SMB", iotType: "File Server" },
    139: { service: "NetBIOS", iotType: "Windows Device" },
    5353: { service: "mDNS", iotType: "Apple/IoT Device" },
    1900: { service: "SSDP", iotType: "Smart Home" },
    49152: { service: "UPnP", iotType: "Smart Device" },
};

export type DeviceType = "IoT Sensor" | "Camera" | "Smart Device" | "Linux Device" |
    "Printer" | "NAS" | "Router" | "Unknown";

export interface DiscoveredDevice {
    macAddress: string;
    ipAddress: string;
    interface: string;
    hostname?: string;
    openPorts?: number[];
    services?: string[];
    deviceType?: DeviceType;
}

export interface NetworkInterface {
    name: string;
    ipAddress: string;
    subnet: string;
    mac: string;
    state: "UP" | "DOWN";
}

/**
 * Parse /proc/net/arp to get devices in the ARP cache
 */
async function parseArpTable(): Promise<DiscoveredDevice[]> {
    try {
        const arpContent = await readFile("/proc/net/arp", "utf-8");
        const lines = arpContent.trim().split("\n");

        // Skip header line
        const devices: DiscoveredDevice[] = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(/\s+/);
            if (parts.length >= 6) {
                const ipAddress = parts[0];
                const macAddress = parts[3].toUpperCase();
                const iface = parts[5];

                // Skip incomplete entries (MAC = 00:00:00:00:00:00)
                if (macAddress !== "00:00:00:00:00:00") {
                    devices.push({
                        ipAddress,
                        macAddress,
                        interface: iface,
                    });
                }
            }
        }
        return devices;
    } catch (error) {
        console.error("Error reading ARP table:", error);
        return [];
    }
}

/**
 * Run arp command to refresh and get current ARP entries
 */
async function runArpCommand(): Promise<DiscoveredDevice[]> {
    try {
        const { stdout } = await execAsync("arp -n 2>/dev/null || cat /proc/net/arp");
        const lines = stdout.trim().split("\n");

        const devices: DiscoveredDevice[] = [];
        for (const line of lines) {
            // Skip header lines
            if (line.includes("Address") || line.includes("IP address")) continue;

            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
                // arp -n format: Address HWtype HWaddress Flags Mask Iface
                const ipAddress = parts[0];
                const macAddress = (parts[2] || parts[3])?.toUpperCase();
                const iface = parts[parts.length - 1];

                if (macAddress && macAddress !== "(INCOMPLETE)" && macAddress !== "00:00:00:00:00:00") {
                    devices.push({
                        ipAddress,
                        macAddress,
                        interface: iface,
                    });
                }
            }
        }
        return devices;
    } catch (error) {
        console.error("Error running arp command:", error);
        return parseArpTable(); // Fallback to /proc/net/arp
    }
}

/**
 * Ping sweep a subnet to populate ARP cache, then read results
 * This is more comprehensive but slower
 */
async function pingSweep(subnet: string, iface: string): Promise<void> {
    try {
        // Extract network prefix (e.g., "192.168.0" from "192.168.0.202/24")
        const parts = subnet.split("/");
        const ip = parts[0];
        const ipParts = ip.split(".");
        const networkPrefix = ipParts.slice(0, 3).join(".");

        console.log(`Ping sweep starting for ${networkPrefix}.1-254...`);

        // Create all ping commands
        const ipsToPing: string[] = [];
        for (let i = 1; i <= 254; i++) {
            ipsToPing.push(`${networkPrefix}.${i}`);
        }

        // Run in smaller batches with proper waiting
        const batchSize = 25; // Smaller batches for more reliable results
        let completed = 0;

        for (let i = 0; i < ipsToPing.length; i += batchSize) {
            const batch = ipsToPing.slice(i, i + batchSize);

            // Run batch in parallel
            await Promise.all(
                batch.map(targetIp =>
                    execAsync(`ping -c 1 -W 1 ${targetIp}`, { timeout: 2000 })
                        .then(() => { })
                        .catch(() => { }) // Ignore errors, we just want to populate ARP
                )
            );

            completed += batch.length;

            // Small delay between batches to let ARP settle
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Wait a bit more for ARP cache to fully populate
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log(`Ping sweep complete. Scanned ${completed} IPs.`);
    } catch (error) {
        console.error("Error during ping sweep:", error);
    }
}

/**
 * Get list of network interfaces with their IP addresses
 */
export async function getNetworkInterfaces(): Promise<NetworkInterface[]> {
    try {
        const { stdout } = await execAsync("ip -o addr show 2>/dev/null");
        const lines = stdout.trim().split("\n");

        const interfaces: NetworkInterface[] = [];
        const seenInterfaces = new Set<string>();

        for (const line of lines) {
            // Parse: 3: wlan0    inet 192.168.0.202/24 brd 192.168.0.255 scope global dynamic noprefixroute wlan0
            const match = line.match(/^\d+:\s+(\S+)\s+inet\s+(\S+)/);
            if (match) {
                const name = match[1];
                const subnet = match[2];

                // Skip loopback and already seen interfaces
                if (name === "lo" || seenInterfaces.has(name)) continue;
                seenInterfaces.add(name);

                const ipAddress = subnet.split("/")[0];

                // Get MAC address
                let mac = "";
                try {
                    const { stdout: linkInfo } = await execAsync(`ip link show ${name} 2>/dev/null`);
                    const macMatch = linkInfo.match(/link\/ether\s+([0-9a-f:]+)/i);
                    if (macMatch) {
                        mac = macMatch[1].toUpperCase();
                    }
                } catch {
                    // Ignore errors
                }

                // Check interface state
                const state = line.includes("UP") ? "UP" : "DOWN";

                interfaces.push({
                    name,
                    ipAddress,
                    subnet,
                    mac,
                    state: state as "UP" | "DOWN",
                });
            }
        }

        return interfaces;
    } catch (error) {
        console.error("Error getting network interfaces:", error);
        return [];
    }
}

/**
 * Scan the local network for devices
 * @param iface - Optional interface name to scan (defaults to first available)
 * @param deep - If true, do a ping sweep first to discover more devices
 */
export async function scanNetwork(iface?: string, deep: boolean = false): Promise<DiscoveredDevice[]> {
    try {
        // If deep scan requested and we have an interface, do ping sweep first
        if (deep && iface) {
            const interfaces = await getNetworkInterfaces();
            const targetInterface = interfaces.find(i => i.name === iface);
            if (targetInterface) {
                console.log(`Starting deep scan on ${iface} (${targetInterface.subnet})...`);
                await pingSweep(targetInterface.subnet, iface);
            }
        }

        // Get devices from ARP
        const devices = await runArpCommand();

        // Filter by interface if specified
        if (iface) {
            return devices.filter(d => d.interface === iface);
        }

        return devices;
    } catch (error) {
        console.error("Error scanning network:", error);
        return [];
    }
}

/**
 * Attempt to resolve hostname for an IP address
 */
export async function resolveHostname(ip: string): Promise<string | undefined> {
    // Try multiple methods to get the real device name

    // 1. Try reverse DNS first (fastest)
    try {
        const { stdout } = await execAsync(`getent hosts ${ip} 2>/dev/null`);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 2) {
            const hostname = parts[1].replace(/\.$/, "");
            if (hostname && !hostname.includes("in-addr.arpa") && hostname !== ip) {
                return hostname;
            }
        }
    } catch { }

    // 2. Try mDNS/Avahi (for Apple/Linux devices with .local names)
    try {
        const { stdout } = await execAsync(`timeout 2 avahi-resolve -a ${ip} 2>/dev/null`);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 2) {
            const hostname = parts[1].replace(/\.local\.?$/, "");
            if (hostname && hostname !== ip) {
                return hostname;
            }
        }
    } catch { }

    // 3. Try NetBIOS name lookup (for Windows devices)
    try {
        const { stdout } = await execAsync(`timeout 2 nmblookup -A ${ip} 2>/dev/null | grep '<00>' | head -1`);
        const match = stdout.match(/^\s*(\S+)\s+<00>/);
        if (match && match[1]) {
            return match[1];
        }
    } catch { }

    // 4. Try DHCP leases (Pi-hole or dnsmasq)
    try {
        // Check Pi-hole leases
        const { stdout: piholeLeases } = await execAsync(`grep "${ip}" /etc/pihole/dhcp.leases 2>/dev/null || true`);
        if (piholeLeases.trim()) {
            const parts = piholeLeases.trim().split(/\s+/);
            if (parts.length >= 4 && parts[3] !== "*") {
                return parts[3];
            }
        }
    } catch { }

    try {
        // Check dnsmasq leases
        const { stdout: dnsmasqLeases } = await execAsync(`grep "${ip}" /var/lib/misc/dnsmasq.leases 2>/dev/null || true`);
        if (dnsmasqLeases.trim()) {
            const parts = dnsmasqLeases.trim().split(/\s+/);
            if (parts.length >= 4 && parts[3] !== "*") {
                return parts[3];
            }
        }
    } catch { }

    // 5. Try ARP table hostname (some routers provide this)
    try {
        const { stdout } = await execAsync(`arp -a ${ip} 2>/dev/null`);
        const match = stdout.match(/^(\S+)\s+\(/);
        if (match && match[1] && match[1] !== "?" && match[1] !== ip) {
            return match[1];
        }
    } catch { }

    // 6. Fallback to 'host' command
    try {
        const { stdout } = await execAsync(`timeout 2 host ${ip} 2>/dev/null`);
        const match = stdout.match(/pointer\s+(\S+)/);
        if (match && match[1]) {
            const hostname = match[1].replace(/\.$/, "");
            if (!hostname.includes("in-addr.arpa")) {
                return hostname;
            }
        }
    } catch { }

    return undefined;
}

/**
 * Common MAC vendor prefixes for IoT devices
 * Format: First 3 bytes of MAC (uppercase, colon-separated) -> Vendor name
 */
const MAC_VENDORS: Record<string, string> = {
    // Espressif (ESP8266, ESP32)
    "24:0A:C4": "ESP",
    "24:6F:28": "ESP",
    "24:62:AB": "ESP",
    "30:AE:A4": "ESP",
    "3C:61:05": "ESP",
    "3C:71:BF": "ESP",
    "40:F5:20": "ESP",
    "48:3F:DA": "ESP",
    "4C:11:AE": "ESP",
    "5C:CF:7F": "ESP",
    "60:01:94": "ESP",
    "68:C6:3A": "ESP",
    "80:7D:3A": "ESP",
    "84:0D:8E": "ESP",
    "84:CC:A8": "ESP",
    "84:F3:EB": "ESP",
    "88:13:BF": "ESP",
    "8C:AA:B5": "ESP",
    "94:B9:7E": "ESP",
    "A0:20:A6": "ESP",
    "A4:7B:9D": "ESP",
    "A4:CF:12": "ESP",
    "AC:67:B2": "ESP",
    "B4:E6:2D": "ESP",
    "BC:DD:C2": "ESP",
    "C4:4F:33": "ESP",
    "C8:2B:96": "ESP",
    "CC:50:E3": "ESP",
    "D8:A0:1D": "ESP",
    "D8:BF:C0": "ESP",
    "DC:4F:22": "ESP",
    "E0:98:06": "ESP",
    "E8:DB:84": "ESP",
    "EC:FA:BC": "ESP",
    "F4:CF:A2": "ESP",
    "FC:F5:C4": "ESP",
    // Raspberry Pi
    "28:CD:C1": "RaspberryPi",
    "2C:CF:67": "RaspberryPi",
    "B8:27:EB": "RaspberryPi",
    "D8:3A:DD": "RaspberryPi",
    "DC:A6:32": "RaspberryPi",
    "E4:5F:01": "RaspberryPi",
    "88:A2:9E": "RaspberryPi",
    // Apple
    "00:1C:B3": "Apple",
    "18:20:32": "Apple",
    "28:CF:E9": "Apple",
    "3C:06:30": "Apple",
    "40:98:AD": "Apple",
    "70:3E:AC": "Apple",
    "78:31:C1": "Apple",
    "A4:5E:60": "Apple",
    "AC:BC:32": "Apple",
    // Google
    "54:60:09": "Google",
    "94:EB:2C": "Google",
    "F4:F5:E8": "Google",
    // Amazon
    "00:FC:8B": "Amazon",
    "10:CE:A9": "Amazon",
    "18:74:2E": "Amazon",
    "34:D2:70": "Amazon",
    "40:B4:CD": "Amazon",
    "44:65:0D": "Amazon",
    "68:54:FD": "Amazon",
    "74:C2:46": "Amazon",
    // Samsung
    "00:15:99": "Samsung",
    "00:21:4C": "Samsung",
    "14:49:E0": "Samsung",
    "34:23:BA": "Samsung",
    "40:4E:36": "Samsung",
    "50:A4:C8": "Samsung",
    "78:47:1D": "Samsung",
    // TP-Link (routers, smart devices)
    "14:CC:20": "TP-Link",
    "18:A6:F7": "TP-Link",
    "1C:3B:F3": "TP-Link",
    "30:B5:C2": "TP-Link",
    "50:C7:BF": "TP-Link",
    "60:32:B1": "TP-Link",
    "B0:4E:26": "TP-Link",
    // Xiaomi
    "04:CF:8C": "Xiaomi",
    "0C:1D:AF": "Xiaomi",
    "10:2A:B3": "Xiaomi",
    "28:6C:07": "Xiaomi",
    "34:CE:00": "Xiaomi",
    "50:64:2B": "Xiaomi",
    "58:44:98": "Xiaomi",
    "64:09:80": "Xiaomi",
    "74:23:44": "Xiaomi",
    "78:11:DC": "Xiaomi",
    "7C:1C:4E": "Xiaomi",
    "B8:1E:A4": "Xiaomi",
    // Intel
    "00:1E:64": "Intel",
    "00:1F:3B": "Intel",
    "3C:97:0E": "Intel",
    "48:51:B7": "Intel",
    "5C:87:9C": "Intel",
    "80:86:F2": "Intel",
    // Sonoff/ITEAD (shares some prefixes with ESP)
    // Note: DC:4F:22 is already listed under ESP
    // Tuya
    "7C:F6:66": "Tuya",
    "D8:1F:12": "Tuya",
    // Generic routers
    "00:1A:2B": "Router",
    "00:50:56": "VMware",
    "08:00:27": "VirtualBox",
};

/**
 * Look up the vendor name from MAC address
 */
export function getMacVendor(mac: string): string | undefined {
    const prefix = mac.toUpperCase().substring(0, 8);
    return MAC_VENDORS[prefix];
}

/**
 * Generate a friendly device name based on available information
 */
export async function generateDeviceName(
    mac: string,
    ip: string
): Promise<string> {
    // First try hostname resolution
    const hostname = await resolveHostname(ip);
    if (hostname && hostname.length > 0 && hostname !== ip) {
        // Clean up hostname - remove domain parts
        const cleanName = hostname.split(".")[0];
        if (cleanName.length > 0) {
            return cleanName;
        }
    }

    // Try MAC vendor lookup
    const vendor = getMacVendor(mac);
    if (vendor) {
        // Generate name like "ESP-60885E" or "RaspberryPi-4C934D"
        const suffix = mac.replace(/:/g, "").slice(-6).toUpperCase();
        return `${vendor}-${suffix}`;
    }

    // Fallback to generic name with MAC suffix
    const suffix = mac.replace(/:/g, "").slice(-6).toUpperCase();
    return `Device-${suffix}`;
}

/**
 * Check if a single port is open on an IP address
 */
function checkPort(ip: string, port: number, timeout: number = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new Socket();

        socket.setTimeout(timeout);

        socket.on("connect", () => {
            socket.destroy();
            resolve(true);
        });

        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });

        socket.on("error", () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, ip);
    });
}

/**
 * Scan common IoT ports on a device
 */
export async function scanPorts(ip: string): Promise<{ openPorts: number[]; services: string[] }> {
    const iotPorts = [80, 443, 22, 1883, 8883, 5683, 554, 8080, 8443, 23, 5000, 9100, 631, 1900];
    const openPorts: number[] = [];
    const services: string[] = [];

    // Scan ports in parallel batches
    const batchSize = 5;
    for (let i = 0; i < iotPorts.length; i += batchSize) {
        const batch = iotPorts.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map(async (port) => ({
                port,
                open: await checkPort(ip, port, 500),
            }))
        );

        for (const { port, open } of results) {
            if (open) {
                openPorts.push(port);
                const portInfo = IOT_PORTS[port];
                if (portInfo) {
                    services.push(portInfo.service);
                }
            }
        }
    }

    return { openPorts, services };
}

/**
 * Classify device type based on MAC vendor and open ports
 */
export function classifyDeviceType(
    macVendor: string | undefined,
    openPorts: number[],
    services: string[]
): DeviceType {
    // MQTT ports indicate IoT sensor
    if (openPorts.includes(1883) || openPorts.includes(8883)) {
        return "IoT Sensor";
    }

    // RTSP indicates camera
    if (openPorts.includes(554) || openPorts.includes(8554)) {
        return "Camera";
    }

    // Printer ports
    if (openPorts.includes(9100) || openPorts.includes(631)) {
        return "Printer";
    }

    // NAS/file server indicators
    if (openPorts.includes(548) || openPorts.includes(445)) {
        return "NAS";
    }

    // Known IoT vendors
    if (macVendor) {
        if (["ESP", "Tuya", "Sonoff", "Xiaomi"].includes(macVendor)) {
            return "IoT Sensor";
        }
        if (["RaspberryPi"].includes(macVendor)) {
            return "Linux Device";
        }
        if (["TP-Link", "Router"].includes(macVendor)) {
            return "Router";
        }
        if (["Amazon", "Google", "Apple"].includes(macVendor)) {
            return "Smart Device";
        }
    }

    // SSH without HTTP might be Linux device
    if (openPorts.includes(22) && !openPorts.includes(80)) {
        return "Linux Device";
    }

    // Web-enabled devices with small footprint are likely IoT
    if (openPorts.includes(80) && openPorts.length <= 2) {
        return "Smart Device";
    }

    return "Unknown";
}

/**
 * Perform full device discovery with port scanning
 */
export async function discoverDeviceDetails(device: DiscoveredDevice): Promise<DiscoveredDevice> {
    // Scan ports
    const { openPorts, services } = await scanPorts(device.ipAddress);

    // Get MAC vendor
    const macVendor = getMacVendor(device.macAddress);

    // Classify device type
    const deviceType = classifyDeviceType(macVendor, openPorts, services);

    return {
        ...device,
        openPorts,
        services,
        deviceType,
    };
}
