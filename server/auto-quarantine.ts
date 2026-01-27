/**
 * Auto-Quarantine Service
 * 
 * Automatically quarantines devices when critical anomalies are detected.
 * Includes whitelist protection for critical infrastructure devices.
 */

import { storage } from "./storage";
import { db } from "./db";
import { devices } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Device } from "@shared/schema";

// Configuration
const QUARANTINE_THRESHOLD = 0.7;  // Score above which to auto-quarantine
const QUARANTINE_DURATION_MS = 60 * 60 * 1000;  // 1 hour auto-release

// Whitelist - devices that should never be auto-quarantined
// Stored by MAC address (uppercase, colon-separated)
const protectedDevices = new Set<string>([
    // These are automatically protected - add your critical devices
]);

// Active quarantines with auto-release timers
const activeQuarantines = new Map<number, {
    deviceId: number;
    quarantinedAt: Date;
    reason: string;
    autoReleaseTimer: NodeJS.Timeout | null;
}>();

/**
 * Check if a device is on the whitelist (protected from auto-quarantine)
 */
export function isDeviceProtected(macAddress: string): boolean {
    return protectedDevices.has(macAddress.toUpperCase());
}

/**
 * Add a device to the protection whitelist
 */
export function addToWhitelist(macAddress: string): void {
    protectedDevices.add(macAddress.toUpperCase());
    console.log(`[AutoQuarantine] Added ${macAddress} to protection whitelist`);
}

/**
 * Remove a device from the protection whitelist
 */
export function removeFromWhitelist(macAddress: string): void {
    protectedDevices.delete(macAddress.toUpperCase());
    console.log(`[AutoQuarantine] Removed ${macAddress} from protection whitelist`);
}

/**
 * Get all protected MAC addresses
 */
export function getWhitelist(): string[] {
    return Array.from(protectedDevices);
}

/**
 * Evaluate if a device should be auto-quarantined based on anomaly score
 */
export async function evaluateForQuarantine(
    device: Device,
    anomalyScore: number,
    reason: string
): Promise<boolean> {
    // Skip if below threshold
    if (anomalyScore < QUARANTINE_THRESHOLD) {
        return false;
    }

    // Skip if device is protected
    if (isDeviceProtected(device.macAddress)) {
        console.log(`[AutoQuarantine] ${device.name} is protected, skipping quarantine`);
        return false;
    }

    // Skip if already quarantined
    if (device.status === "quarantined" || device.status === "blocked") {
        return false;
    }

    // Skip if already in active quarantine
    if (activeQuarantines.has(device.id)) {
        return false;
    }

    // Auto-quarantine the device
    console.log(`[AutoQuarantine] CRITICAL ANOMALY (score: ${anomalyScore.toFixed(2)}) - Quarantining ${device.name}`);

    try {
        await quarantineDevice(device, reason, anomalyScore);
        return true;
    } catch (error) {
        console.error(`[AutoQuarantine] Failed to quarantine ${device.name}:`, error);
        return false;
    }
}

/**
 * Quarantine a device with optional auto-release
 */
async function quarantineDevice(
    device: Device,
    reason: string,
    anomalyScore: number
): Promise<void> {
    // Update device status to quarantined
    await db.update(devices).set({ status: "quarantined" }).where(eq(devices.id, device.id));

    // Block network access via iptables
    const { networkBlockService } = await import("./network-block");
    await networkBlockService.blockDevice(
        device.id,
        device.ipAddress,
        device.macAddress,
        `Auto-quarantine: ${reason} (score: ${anomalyScore.toFixed(2)})`,
        "quarantined"
    );

    // Also block via Pi-hole DNS for defense in depth
    try {
        const { blockDeviceViaDns } = await import("./pihole-service");
        await blockDeviceViaDns(device.ipAddress, device.name);
        console.log(`[AutoQuarantine] Also blocked ${device.name} via Pi-hole DNS`);
    } catch (piholeError) {
        console.log(`[AutoQuarantine] Pi-hole blocking skipped:`, piholeError);
    }

    // Create alert
    const baselineService = await import("./baseline-service");
    await baselineService.createAnomalyAlert(
        device,
        "auto_quarantine",
        `Device auto-quarantined: ${reason}`,
        anomalyScore
    );

    // Create quarantine record for the Quarantine page UI
    await storage.createQuarantineRecord({
        deviceId: device.id,
        deviceName: device.name,
        reason: `${reason} (score: ${anomalyScore.toFixed(2)})`,
        timeQuarantined: new Date(),
    });

    // Set up auto-release timer
    const autoReleaseTimer = setTimeout(() => {
        releaseFromQuarantine(device.id);
    }, QUARANTINE_DURATION_MS);

    // Track active quarantine
    activeQuarantines.set(device.id, {
        deviceId: device.id,
        quarantinedAt: new Date(),
        reason,
        autoReleaseTimer,
    });

    console.log(`[AutoQuarantine] ${device.name} quarantined. Auto-release in ${QUARANTINE_DURATION_MS / 60000} minutes`);
}

/**
 * Release a device from quarantine
 */
export async function releaseFromQuarantine(deviceId: number): Promise<boolean> {
    const quarantine = activeQuarantines.get(deviceId);

    if (quarantine?.autoReleaseTimer) {
        clearTimeout(quarantine.autoReleaseTimer);
    }

    activeQuarantines.delete(deviceId);

    try {
        const device = await storage.getDevice(deviceId);
        if (!device) return false;

        // Unblock network access
        const { networkBlockService } = await import("./network-block");
        await networkBlockService.unblockDevice(String(deviceId));

        // Update status back to approved or monitoring
        await db.update(devices).set({ status: "approved" }).where(eq(devices.id, deviceId));

        console.log(`[AutoQuarantine] ${device.name} released from quarantine`);
        return true;
    } catch (error) {
        console.error(`[AutoQuarantine] Failed to release device ${deviceId}:`, error);
        return false;
    }
}

/**
 * Get all active quarantines
 */
export function getActiveQuarantines(): Array<{
    deviceId: number;
    quarantinedAt: Date;
    reason: string;
    autoReleaseIn: number;  // ms until auto-release
}> {
    const now = Date.now();
    return Array.from(activeQuarantines.values()).map(q => ({
        deviceId: q.deviceId,
        quarantinedAt: q.quarantinedAt,
        reason: q.reason,
        autoReleaseIn: Math.max(0, QUARANTINE_DURATION_MS - (now - q.quarantinedAt.getTime())),
    }));
}

/**
 * Get quarantine configuration
 */
export function getQuarantineConfig() {
    return {
        threshold: QUARANTINE_THRESHOLD,
        durationMs: QUARANTINE_DURATION_MS,
        protectedCount: protectedDevices.size,
        activeCount: activeQuarantines.size,
    };
}

// Initialize with some default protected devices
export function initializeProtectedDevices(devices: Device[]): void {
    // Protect routers (commonly named OpenWrt, Router, Gateway)
    devices.forEach(device => {
        const name = device.name.toLowerCase();
        if (
            name.includes("openwrt") ||
            name.includes("router") ||
            name.includes("gateway") ||
            name.includes("pi") ||
            name.includes("raspberry")
        ) {
            addToWhitelist(device.macAddress);
        }
    });

    console.log(`[AutoQuarantine] Initialized with ${protectedDevices.size} protected devices`);
}
