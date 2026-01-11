import { scanNetwork, getNetworkInterfaces, generateDeviceName } from "./network-scanner";
import { storage } from "./storage";
import { spawn, ChildProcess } from "child_process";

let scanIntervalId: NodeJS.Timeout | null = null;
let quickScanIntervalId: NodeJS.Timeout | null = null;
let arpWatchProcess: ChildProcess | null = null;
let isScanning = false;

export interface ScannerStatus {
    running: boolean;
    lastScan: Date | null;
    lastQuickScan: Date | null;
    intervalMinutes: number;
    quickIntervalSeconds: number;
    devicesFound: number;
    arpWatchActive: boolean;
    mode: "efficient" | "aggressive";
}

let status: ScannerStatus = {
    running: false,
    lastScan: null,
    lastQuickScan: null,
    intervalMinutes: 10,      // Deep scan every 10 min
    quickIntervalSeconds: 60, // Quick scan every 60 sec
    devicesFound: 0,
    arpWatchActive: false,
    mode: "efficient",
};

// Track known MACs to avoid duplicate processing
const knownMacs = new Set<string>();

/**
 * Quick ARP table check - very lightweight
 */
async function quickArpScan(): Promise<void> {
    try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        // Just read ARP table - no network traffic
        const { stdout } = await execAsync("ip neigh show | grep -v FAILED");
        const lines = stdout.trim().split("\n");

        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 5 && parts[4]) {
                const ip = parts[0];
                const mac = parts[4].toUpperCase();

                // Skip invalid MACs
                if (!mac.includes(":") || mac === "INCOMPLETE") continue;

                // Check if new device
                if (!knownMacs.has(mac)) {
                    const existingDevice = await storage.getDeviceByMac(mac);

                    if (!existingDevice) {
                        // New device found!
                        const deviceName = await generateDeviceName(mac, ip);

                        await storage.createDevice({
                            name: deviceName,
                            macAddress: mac,
                            ipAddress: ip,
                            status: "new",
                            firstSeen: new Date(),
                            lastSeen: new Date(),
                            trafficRate: 0,
                            avgTrafficRate: 0,
                            protocols: {},
                        });

                        await storage.createLog({
                            timestamp: new Date(),
                            eventType: "device_discovered",
                            performedBy: "system",
                            deviceName: deviceName,
                            details: `Quick scan discovered new device: ${deviceName} (${ip})`,
                        });

                        console.log(`[BackgroundScanner] Quick scan: New device ${deviceName} (${ip})`);

                        // Send notification
                        try {
                            const { notificationService } = await import("./notification-service");
                            const device = await storage.getDeviceByMac(mac);
                            if (device) {
                                await notificationService.notifyNewDevice(deviceName, ip, mac, device.id);
                            }
                        } catch { }
                    } else {
                        // Update IP if changed
                        if (existingDevice.ipAddress !== ip) {
                            await storage.updateDeviceIp(existingDevice.id, ip);
                        } else {
                            await storage.updateDeviceMetrics(existingDevice.id, existingDevice.trafficRate);
                        }
                    }

                    knownMacs.add(mac);
                }
            }
        }

        status.lastQuickScan = new Date();
    } catch (error) {
        // Silently ignore quick scan errors
    }
}

/**
 * Run a full network scan (deeper, uses ARP scan)
 */
async function runDeepScan(): Promise<number> {
    if (isScanning) {
        console.log("[BackgroundScanner] Scan already in progress, skipping...");
        return 0;
    }

    isScanning = true;
    console.log("[BackgroundScanner] Starting deep network scan...");

    try {
        const interfaces = await getNetworkInterfaces();
        const iface = interfaces.find(i => i.state === "UP")?.name;

        if (!iface) {
            console.log("[BackgroundScanner] No active network interface found");
            return 0;
        }

        const discoveredDevices = await scanNetwork(iface, true);
        let newDevicesCount = 0;

        for (const discovered of discoveredDevices) {
            const mac = discovered.macAddress.toUpperCase();
            const existingDevice = await storage.getDeviceByMac(mac);

            if (!existingDevice) {
                const deviceName = await generateDeviceName(mac, discovered.ipAddress);

                await storage.createDevice({
                    name: deviceName,
                    macAddress: mac,
                    ipAddress: discovered.ipAddress,
                    status: "new",
                    firstSeen: new Date(),
                    lastSeen: new Date(),
                    trafficRate: 0,
                    avgTrafficRate: 0,
                    protocols: {},
                });

                await storage.createLog({
                    timestamp: new Date(),
                    eventType: "device_discovered",
                    performedBy: "system",
                    deviceName: deviceName,
                    details: `Deep scan discovered new device: ${deviceName} (${discovered.ipAddress})`,
                });

                // Send notification
                try {
                    const { notificationService } = await import("./notification-service");
                    const device = await storage.getDeviceByMac(mac);
                    if (device) {
                        await notificationService.notifyNewDevice(deviceName, discovered.ipAddress, mac, device.id);
                    }
                } catch { }

                newDevicesCount++;
            } else {
                // Update IP if changed
                if (existingDevice.ipAddress !== discovered.ipAddress) {
                    await storage.updateDeviceIp(existingDevice.id, discovered.ipAddress);
                    console.log(`[BackgroundScanner] Updated IP for ${existingDevice.name}: ${existingDevice.ipAddress} -> ${discovered.ipAddress}`);
                } else {
                    await storage.updateDeviceMetrics(existingDevice.id, existingDevice.trafficRate);
                }
            }

            knownMacs.add(mac);
        }

        status.lastScan = new Date();
        status.devicesFound = discoveredDevices.length;

        console.log(`[BackgroundScanner] Deep scan complete. Found ${discoveredDevices.length} devices, ${newDevicesCount} new.`);
        return newDevicesCount;
    } catch (error) {
        console.error("[BackgroundScanner] Error during deep scan:", error);
        return 0;
    } finally {
        isScanning = false;
    }
}

/**
 * Start passive ARP monitoring (instant new device detection)
 */
function startArpWatch(): void {
    if (arpWatchProcess) return;

    try {
        // Use ip monitor to watch for new ARP entries
        arpWatchProcess = spawn("ip", ["monitor", "neigh"], { stdio: ["ignore", "pipe", "ignore"] });

        arpWatchProcess.stdout?.on("data", async (data: Buffer) => {
            const lines = data.toString().split("\n");
            for (const line of lines) {
                // Look for new REACHABLE or STALE entries
                if (line.includes("lladdr") && (line.includes("REACHABLE") || line.includes("STALE"))) {
                    const parts = line.split(/\s+/);
                    const ip = parts[0];
                    const macIndex = parts.indexOf("lladdr") + 1;
                    const mac = parts[macIndex]?.toUpperCase();

                    if (mac && mac.includes(":") && !knownMacs.has(mac)) {
                        // Immediate new device detection!
                        setTimeout(async () => {
                            try {
                                const existingDevice = await storage.getDeviceByMac(mac);
                                if (!existingDevice) {
                                    const deviceName = await generateDeviceName(mac, ip);

                                    await storage.createDevice({
                                        name: deviceName,
                                        macAddress: mac,
                                        ipAddress: ip,
                                        status: "new",
                                        firstSeen: new Date(),
                                        lastSeen: new Date(),
                                        trafficRate: 0,
                                        avgTrafficRate: 0,
                                        protocols: {},
                                    });

                                    console.log(`[BackgroundScanner] ARP Watch: Instant detection of ${deviceName} (${ip})`);

                                    // Notify
                                    const device = await storage.getDeviceByMac(mac);
                                    if (device) {
                                        const { notificationService } = await import("./notification-service");
                                        await notificationService.notifyNewDevice(deviceName, ip, mac, device.id);
                                    }
                                }
                                knownMacs.add(mac);
                            } catch { }
                        }, 100);
                    }
                }
            }
        });

        arpWatchProcess.on("exit", () => {
            status.arpWatchActive = false;
            arpWatchProcess = null;
        });

        status.arpWatchActive = true;
        console.log("[BackgroundScanner] Passive ARP monitoring started");
    } catch (error) {
        console.error("[BackgroundScanner] Failed to start ARP watch:", error);
    }
}

/**
 * Stop passive ARP monitoring
 */
function stopArpWatch(): void {
    if (arpWatchProcess) {
        arpWatchProcess.kill();
        arpWatchProcess = null;
        status.arpWatchActive = false;
        console.log("[BackgroundScanner] Passive ARP monitoring stopped");
    }
}

/**
 * Initialize known MACs from database
 */
async function loadKnownMacs(): Promise<void> {
    try {
        const devices = await storage.getDevices();
        devices.forEach(d => knownMacs.add(d.macAddress.toUpperCase()));
        console.log(`[BackgroundScanner] Loaded ${knownMacs.size} known devices`);
    } catch { }
}

/**
 * Start the background scanner (optimized for 24/7)
 */
export function startBackgroundScanner(intervalMinutes: number = 10): void {
    if (scanIntervalId) {
        console.log("[BackgroundScanner] Already running, stopping first...");
        stopBackgroundScanner();
    }

    status.intervalMinutes = intervalMinutes;
    status.running = true;
    status.mode = "efficient";

    console.log(`[BackgroundScanner] Starting 24/7 efficient mode:`);
    console.log(`  - Deep scan: every ${intervalMinutes} minutes`);
    console.log(`  - Quick scan: every ${status.quickIntervalSeconds} seconds`);
    console.log(`  - ARP watch: real-time detection`);

    // Load known devices from DB
    loadKnownMacs();

    // Start passive ARP monitoring (instant detection)
    startArpWatch();

    // Run initial deep scan after 10 seconds
    setTimeout(() => {
        runDeepScan();
    }, 10000);

    // Quick scans every 60 seconds (very lightweight)
    quickScanIntervalId = setInterval(() => {
        quickArpScan();
    }, status.quickIntervalSeconds * 1000);

    // Deep scans at specified interval
    scanIntervalId = setInterval(() => {
        runDeepScan();
    }, intervalMinutes * 60 * 1000);
}

/**
 * Stop the background scanner
 */
export function stopBackgroundScanner(): void {
    if (scanIntervalId) {
        clearInterval(scanIntervalId);
        scanIntervalId = null;
    }
    if (quickScanIntervalId) {
        clearInterval(quickScanIntervalId);
        quickScanIntervalId = null;
    }
    stopArpWatch();
    status.running = false;
    console.log("[BackgroundScanner] Stopped");
}

/**
 * Get the current scanner status
 */
export function getScannerStatus(): ScannerStatus {
    return { ...status };
}

/**
 * Trigger an immediate deep scan
 */
export async function triggerScan(): Promise<number> {
    return runDeepScan();
}

/**
 * Update the scan interval
 */
export function setScanInterval(intervalMinutes: number): void {
    if (intervalMinutes < 1) intervalMinutes = 1;
    if (intervalMinutes > 60) intervalMinutes = 60;

    const wasRunning = status.running;
    if (wasRunning) {
        stopBackgroundScanner();
    }

    status.intervalMinutes = intervalMinutes;

    if (wasRunning) {
        startBackgroundScanner(intervalMinutes);
    }
}
