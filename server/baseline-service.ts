import { db } from "./db";
import { deviceBaselines, devices, flowEvents, alerts } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import type { Device, DeviceBaseline, InsertDeviceBaseline } from "@shared/schema";
import { storage } from "./storage";

// Default thresholds for anomaly detection
const TRAFFIC_ANOMALY_MULTIPLIER = 3; // 3x baseline = anomaly
const CONNECTION_ANOMALY_MULTIPLIER = 3;

// Cache of devices currently in learning mode
const learningDevices = new Map<number, {
    startedAt: Date;
    durationMs: number;
    flows: Array<{
        protocol: string;
        destIp: string;
        destPort: number;
        bytes: number;
        timestamp: Date;
    }>;
}>();

/**
 * Start baseline learning for a device
 */
export async function startBaselineLearning(device: Device, durationMs: number = 60 * 60 * 1000): Promise<void> {
    console.log(`[BaselineService] Starting learning for ${device.name} (${durationMs / 60000} min)`);

    // Create or update baseline record
    const existingBaseline = await getDeviceBaseline(device.id);

    if (existingBaseline) {
        // Reset existing baseline for re-learning
        await db.update(deviceBaselines)
            .set({
                learningStartedAt: new Date(),
                learningCompletedAt: null,
                isComplete: 0,
                flowsAnalyzed: 0,
                protocols: [],
                destinations: [],
                ports: [],
                activeHours: {},
                avgBytesPerSec: 0,
                maxBytesPerSec: 0,
                avgConnectionsPerMin: 0,
            })
            .where(eq(deviceBaselines.id, existingBaseline.id));
    } else {
        // Create new baseline record
        await db.insert(deviceBaselines).values({
            deviceId: device.id,
            learningStartedAt: new Date(),
            isComplete: 0,
        });
    }

    // Initialize in-memory tracking
    learningDevices.set(device.id, {
        startedAt: new Date(),
        durationMs,
        flows: [],
    });

    // Schedule completion
    setTimeout(async () => {
        await completeBaselineLearning(device.id);
    }, durationMs);
}

/**
 * Add a flow to a learning device's data
 */
export function addFlowToLearning(deviceId: number, flow: {
    protocol: string;
    destIp: string;
    destPort: number;
    bytes: number;
    timestamp: Date;
}): void {
    const learning = learningDevices.get(deviceId);
    if (learning) {
        learning.flows.push(flow);

        // Also feed to AI model for statistical learning
        const { addFlowObservation } = require("./ai-anomaly-detector");
        addFlowObservation(deviceId, flow);
    }
}

/**
 * Check if a device is currently learning
 */
export function isDeviceLearning(deviceId: number): boolean {
    return learningDevices.has(deviceId);
}

/**
 * Get learning progress for a device (0-100%)
 */
export function getLearningProgress(deviceId: number): number {
    const learning = learningDevices.get(deviceId);
    if (!learning) return 100;

    const elapsed = Date.now() - learning.startedAt.getTime();
    return Math.min(100, Math.round((elapsed / learning.durationMs) * 100));
}

/**
 * Complete baseline learning and build profile
 */
async function completeBaselineLearning(deviceId: number): Promise<void> {
    const learning = learningDevices.get(deviceId);
    if (!learning) return;

    console.log(`[BaselineService] Completing learning for device ${deviceId} with ${learning.flows.length} flows`);

    // Build profile from collected flows
    const profile = buildProfile(learning.flows, learning.durationMs);

    // Update baseline record
    await db.update(deviceBaselines)
        .set({
            avgBytesPerSec: profile.avgBytesPerSec,
            maxBytesPerSec: profile.maxBytesPerSec,
            avgConnectionsPerMin: profile.avgConnectionsPerMin,
            protocols: profile.protocols,
            destinations: profile.destinations,
            ports: profile.ports,
            activeHours: profile.activeHours,
            flowsAnalyzed: learning.flows.length,
            learningCompletedAt: new Date(),
            isComplete: 1,
        })
        .where(eq(deviceBaselines.deviceId, deviceId));

    // Update device status to approved
    await db.update(devices)
        .set({
            status: "approved",
            avgTrafficRate: profile.avgBytesPerSec,
        })
        .where(eq(devices.id, deviceId));

    // Log completion
    const device = await storage.getDevice(deviceId);
    if (device) {
        await storage.createLog({
            timestamp: new Date(),
            eventType: "device_approved",
            performedBy: "system",
            deviceId: device.id,
            deviceName: device.name,
            details: `Baseline learning completed for ${device.name}. Analyzed ${learning.flows.length} flows. ` +
                `Protocols: ${profile.protocols.join(", ")}. Avg traffic: ${profile.avgBytesPerSec.toFixed(1)} B/s`,
        });
    }

    // Clean up
    learningDevices.delete(deviceId);
    console.log(`[BaselineService] Learning complete for device ${deviceId}`);
}

/**
 * Build a behavior profile from collected flows
 */
function buildProfile(flows: Array<{
    protocol: string;
    destIp: string;
    destPort: number;
    bytes: number;
    timestamp: Date;
}>, durationMs: number): {
    avgBytesPerSec: number;
    maxBytesPerSec: number;
    avgConnectionsPerMin: number;
    protocols: string[];
    destinations: string[];
    ports: number[];
    activeHours: Record<string, number>;
} {
    if (flows.length === 0) {
        return {
            avgBytesPerSec: 0,
            maxBytesPerSec: 0,
            avgConnectionsPerMin: 0,
            protocols: [],
            destinations: [],
            ports: [],
            activeHours: {},
        };
    }

    // Calculate traffic metrics
    const totalBytes = flows.reduce((sum, f) => sum + f.bytes, 0);
    const durationSec = durationMs / 1000;
    const avgBytesPerSec = totalBytes / durationSec;

    // Group by minute to find max
    const byMinute = new Map<number, number>();
    flows.forEach(f => {
        const min = Math.floor(f.timestamp.getTime() / 60000);
        byMinute.set(min, (byMinute.get(min) || 0) + f.bytes);
    });
    const maxBytesPerMin = Math.max(...Array.from(byMinute.values()));
    const maxBytesPerSec = maxBytesPerMin / 60;

    // Calculate connections per minute
    const durationMin = durationMs / 60000;
    const avgConnectionsPerMin = flows.length / durationMin;

    // Unique protocols
    const protocols = Array.from(new Set(flows.map(f => f.protocol)));

    // Top destinations (limit to 20)
    const destCounts = new Map<string, number>();
    flows.forEach(f => {
        destCounts.set(f.destIp, (destCounts.get(f.destIp) || 0) + 1);
    });
    const destinations = Array.from(destCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([ip]) => ip);

    // Top ports (limit to 20)
    const portCounts = new Map<number, number>();
    flows.forEach(f => {
        portCounts.set(f.destPort, (portCounts.get(f.destPort) || 0) + 1);
    });
    const ports = Array.from(portCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([port]) => port);

    // Active hours
    const hourCounts: Record<string, number> = {};
    flows.forEach(f => {
        const hour = f.timestamp.getHours().toString();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    return {
        avgBytesPerSec,
        maxBytesPerSec,
        avgConnectionsPerMin,
        protocols,
        destinations,
        ports,
        activeHours: hourCounts,
    };
}

/**
 * Get a device's baseline profile
 */
export async function getDeviceBaseline(deviceId: number): Promise<DeviceBaseline | undefined> {
    const [baseline] = await db.select()
        .from(deviceBaselines)
        .where(eq(deviceBaselines.deviceId, deviceId));
    return baseline;
}

/**
 * Check a flow against device baseline for anomalies
 */
export async function checkFlowForAnomaly(deviceId: number, flow: {
    protocol: string;
    destIp: string;
    destPort: number;
    bytes: number;
}): Promise<{
    isAnomaly: boolean;
    reasons: string[];
    anomalyScore?: number;
    confidence?: number;
}> {
    const baseline = await getDeviceBaseline(deviceId);

    // If no baseline or still learning, no anomaly check
    if (!baseline || baseline.isComplete !== 1) {
        return { isAnomaly: false, reasons: [] };
    }

    // Use AI analyzer for intelligent detection
    const { analyzeFlow } = require("./ai-anomaly-detector");
    const analysis = analyzeFlow(deviceId, {
        bytes: flow.bytes,
        protocol: flow.protocol,
        destIp: flow.destIp,
        timestamp: new Date(),
    });

    // If AI has enough data, use its analysis
    if (analysis.confidence > 0.3) {
        return {
            isAnomaly: analysis.isAnomaly,
            reasons: analysis.reasons,
            anomalyScore: analysis.anomalyScore,
            confidence: analysis.confidence,
        };
    }

    // Fallback to rule-based detection for low confidence
    const reasons: string[] = [];

    // Check for new protocol
    const protocols = (baseline.protocols as string[]) || [];
    if (!protocols.includes(flow.protocol)) {
        reasons.push(`New protocol detected: ${flow.protocol}`);
    }

    // Check for new destination
    const destinations = (baseline.destinations as string[]) || [];
    if (destinations.length > 0 && !destinations.includes(flow.destIp)) {
        if (destinations.length < 50) {
            reasons.push(`New destination: ${flow.destIp}`);
        }
    }

    // Check for new port
    const ports = (baseline.ports as number[]) || [];
    if (ports.length > 0 && !ports.includes(flow.destPort)) {
        if (ports.length < 50) {
            reasons.push(`New port: ${flow.destPort}`);
        }
    }

    return {
        isAnomaly: reasons.length > 0,
        reasons,
    };
}

/**
 * Check overall traffic rate against baseline
 */
export async function checkTrafficRateAnomaly(
    deviceId: number,
    currentBytesPerSec: number
): Promise<boolean> {
    const baseline = await getDeviceBaseline(deviceId);

    if (!baseline || baseline.isComplete !== 1 || baseline.avgBytesPerSec === 0) {
        return false;
    }

    // Check if current rate is significantly higher than baseline
    const threshold = baseline.avgBytesPerSec * TRAFFIC_ANOMALY_MULTIPLIER;
    return currentBytesPerSec > threshold;
}

/**
 * Create an anomaly alert for a device
 */
export async function createAnomalyAlert(
    device: Device,
    anomalyType: string,
    description: string,
    severity: "low" | "medium" | "high" | "critical" = "medium"
): Promise<void> {
    // Calculate anomaly score based on severity
    const severityScores = { low: 0.3, medium: 0.5, high: 0.7, critical: 0.9 };

    await storage.createAlert({
        deviceId: device.id,
        deviceName: device.name,
        timestamp: new Date(),
        anomalyType,
        severity,
        status: "open",
        anomalyScore: severityScores[severity],
        description,
    });

    console.log(`[BaselineService] Alert created for ${device.name}: ${anomalyType}`);
}

/**
 * Get all device baselines
 */
export async function getAllBaselines(): Promise<DeviceBaseline[]> {
    return await db.select().from(deviceBaselines);
}

/**
 * Get learning status for all devices
 */
export function getAllLearningStatus(): Array<{
    deviceId: number;
    progress: number;
    flowsCollected: number;
    startedAt: Date;
}> {
    const result: Array<{
        deviceId: number;
        progress: number;
        flowsCollected: number;
        startedAt: Date;
    }> = [];

    learningDevices.forEach((learning, deviceId) => {
        result.push({
            deviceId,
            progress: getLearningProgress(deviceId),
            flowsCollected: learning.flows.length,
            startedAt: learning.startedAt,
        });
    });

    return result;
}
