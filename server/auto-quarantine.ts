/**
 * Auto-Quarantine Service
 * 
 * Automatically quarantines devices when critical anomalies are detected.
 * Includes whitelist protection for critical infrastructure devices.
 */

import { storage } from "./storage";
import { db } from "./db";
import { devices, quarantineRecords } from "@shared/schema";
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
    console.log(`[AutoQuarantine] Evaluating ${device.name} (ID: ${device.id}) - Score: ${anomalyScore}, Reason: ${reason}`);

    // Skip if below threshold
    if (anomalyScore < QUARANTINE_THRESHOLD) {
        console.log(`[AutoQuarantine] SKIPPED: Score ${anomalyScore} below threshold ${QUARANTINE_THRESHOLD}`);
        return false;
    }

    // Skip if device is protected
    if (isDeviceProtected(device.macAddress)) {
        console.log(`[AutoQuarantine] ${device.name} is protected, skipping quarantine`);
        return false;
    }

    // Skip if already quarantined or blocked
    if (device.status === "quarantined" || device.status === "blocked") {
        console.log(`[AutoQuarantine] SKIPPED: Device already ${device.status}`);
        return false;
    }

    // Skip if already in active quarantine
    if (activeQuarantines.has(device.id)) {
        console.log(`[AutoQuarantine] SKIPPED: Device already in active quarantines Map`);
        return false;
    }

    // Check if this is a repeat offender (quarantined 2+ times before)
    const previousQuarantines = await countPreviousQuarantines(device.id);
    const MAX_QUARANTINES_BEFORE_BLOCK = 2;

    console.log(`[AutoQuarantine] ${device.name} has ${previousQuarantines} previous quarantines`);

    if (previousQuarantines >= MAX_QUARANTINES_BEFORE_BLOCK) {
        console.log(`[AutoQuarantine] REPEAT OFFENDER: ${device.name} has been quarantined ${previousQuarantines} times. BLOCKING permanently.`);
        try {
            await blockDevicePermanently(device, reason, anomalyScore, previousQuarantines);
            return true;
        } catch (error) {
            console.error(`[AutoQuarantine] Failed to block repeat offender ${device.name}:`, error);
            return false;
        }
    }

    // Auto-quarantine the device
    console.log(`[AutoQuarantine] CRITICAL ANOMALY (score: ${anomalyScore.toFixed(2)}) - Quarantining ${device.name} (quarantine #${previousQuarantines + 1})`);

    try {
        await quarantineDevice(device, reason, anomalyScore);
        return true;
    } catch (error) {
        console.error(`[AutoQuarantine] Failed to quarantine ${device.name}:`, error);
        return false;
    }
}

/**
 * Count how many times a device has been quarantined before
 */
async function countPreviousQuarantines(deviceId: number): Promise<number> {
    // Count auto_quarantine alerts for this device
    const alerts = await storage.getAlerts();
    return alerts.filter(a =>
        a.deviceId === deviceId &&
        a.anomalyType === "auto_quarantine"
    ).length;
}

/**
 * Permanently block a repeat offender device
 */
async function blockDevicePermanently(
    device: Device,
    reason: string,
    anomalyScore: number,
    previousQuarantines: number
): Promise<void> {
    // Update device status to blocked
    await db.update(devices).set({ status: "blocked" }).where(eq(devices.id, device.id));

    // Block network access via iptables
    const { networkBlockService } = await import("./network-block");
    await networkBlockService.blockDevice(
        device.id,
        device.ipAddress,
        device.macAddress,
        `PERMANENTLY BLOCKED - Repeat offender (${previousQuarantines + 1} violations): ${reason}`,
        "blocked"
    );

    // Create alert
    const baselineService = await import("./baseline-service");
    await baselineService.createAnomalyAlert(
        device,
        "auto_block",
        `REPEAT OFFENDER BLOCKED: ${previousQuarantines + 1} violations. Latest: ${reason}`,
        0.99  // Maximum severity for blocked devices
    );

    // Create log entry
    await storage.createLog({
        timestamp: new Date(),
        eventType: "device_blocked",
        performedBy: "system",
        deviceId: device.id,
        deviceName: device.name,
        details: `Permanently blocked due to repeat violations (${previousQuarantines + 1} quarantines). Latest reason: ${reason}`,
    });

    // Send notification
    const { notificationService } = await import("./notification-service");
    await notificationService.notifyAutoBlocked(device.name, `${previousQuarantines + 1} violations. Latest: ${reason}`, device.id);

    console.log(`[AutoQuarantine] ${device.name} PERMANENTLY BLOCKED after ${previousQuarantines + 1} quarantines`);
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

    // Create log entry for audit trail
    await storage.createLog({
        timestamp: new Date(),
        eventType: "device_quarantined",
        performedBy: "system",
        deviceId: device.id,
        deviceName: device.name,
        details: `Auto-quarantined due to: ${reason} (anomaly score: ${anomalyScore.toFixed(2)})`,
    });

    // Send notification
    const { notificationService } = await import("./notification-service");
    await notificationService.notifyDeviceQuarantined(device.name, `${reason} (score: ${anomalyScore.toFixed(2)})`, device.id);

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

        // Delete quarantine record from database so it updates the Quarantine page
        await db.delete(quarantineRecords).where(eq(quarantineRecords.deviceId, deviceId));

        // Create log entry
        await storage.createLog({
            timestamp: new Date(),
            eventType: "device_released",
            performedBy: "system",
            deviceId: device.id,
            deviceName: device.name,
            details: `Auto-released from quarantine after timeout`,
        });

        // Send notification
        const { notificationService } = await import("./notification-service");
        await notificationService.notify(
            "device_online",
            "✅ Device Released from Quarantine",
            `${device.name} has been automatically released from quarantine.`,
            { deviceId: device.id, deviceName: device.name, severity: "info" }
        );

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
