import { scanNetwork, getNetworkInterfaces, generateDeviceName } from "./network-scanner";
import { storage } from "./storage";

let scanIntervalId: NodeJS.Timeout | null = null;
let isScanning = false;

export interface ScannerStatus {
    running: boolean;
    lastScan: Date | null;
    intervalMinutes: number;
    devicesFound: number;
}

let status: ScannerStatus = {
    running: false,
    lastScan: null,
    intervalMinutes: 5,
    devicesFound: 0,
};

/**
 * Run a single network scan and add new devices
 */
async function runScan(): Promise<number> {
    if (isScanning) {
        console.log("[BackgroundScanner] Scan already in progress, skipping...");
        return 0;
    }

    isScanning = true;
    console.log("[BackgroundScanner] Starting scheduled network scan...");

    try {
        // Get the first available interface
        const interfaces = await getNetworkInterfaces();
        const iface = interfaces.find(i => i.state === "UP")?.name;

        if (!iface) {
            console.log("[BackgroundScanner] No active network interface found");
            return 0;
        }

        // Run a deep scan to find all devices
        const discoveredDevices = await scanNetwork(iface, true);
        let newDevicesCount = 0;

        for (const discovered of discoveredDevices) {
            const existingDevice = await storage.getDeviceByMac(discovered.macAddress);

            if (!existingDevice) {
                // Generate a friendly name from hostname or MAC vendor
                const deviceName = await generateDeviceName(discovered.macAddress, discovered.ipAddress);

                await storage.createDevice({
                    name: deviceName,
                    macAddress: discovered.macAddress.toUpperCase(),
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
                    details: `Background scan discovered new device: ${deviceName} (${discovered.ipAddress})`,
                });

                newDevicesCount++;
            } else {
                // Update last seen
                await storage.updateDeviceMetrics(existingDevice.id, existingDevice.trafficRate);
            }
        }

        status.lastScan = new Date();
        status.devicesFound = discoveredDevices.length;

        console.log(`[BackgroundScanner] Scan complete. Found ${discoveredDevices.length} devices, ${newDevicesCount} new.`);
        return newDevicesCount;
    } catch (error) {
        console.error("[BackgroundScanner] Error during scan:", error);
        return 0;
    } finally {
        isScanning = false;
    }
}

/**
 * Start the background scanner with the specified interval
 */
export function startBackgroundScanner(intervalMinutes: number = 5): void {
    if (scanIntervalId) {
        console.log("[BackgroundScanner] Already running, stopping first...");
        stopBackgroundScanner();
    }

    status.intervalMinutes = intervalMinutes;
    status.running = true;

    console.log(`[BackgroundScanner] Starting with ${intervalMinutes} minute interval`);

    // Run initial scan after 30 seconds to let the server stabilize
    setTimeout(() => {
        runScan();
    }, 30000);

    // Then run periodically
    scanIntervalId = setInterval(() => {
        runScan();
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
 * Trigger an immediate scan
 */
export async function triggerScan(): Promise<number> {
    return runScan();
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
