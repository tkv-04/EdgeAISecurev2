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
                learningDurationMs: durationMs,  // Save duration for persistence
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
            learningDurationMs: durationMs,  // Save duration for persistence
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

        // Log every 10th flow to confirm data is being collected
        if (learning.flows.length % 10 === 1) {
            console.log(`[BaselineService] Learning device ${deviceId}: ${learning.flows.length} flows collected`);
        }

        // Feed to AI model for statistical learning (async)
        import("./ai-anomaly-detector").then(({ addFlowObservation }) => {
            addFlowObservation(deviceId, flow);
        }).catch(() => { });

        // Feed to Isolation Forest
        import("./ml/isolation-forest").then(({ flowToFeatures, addTrainingSample }) => {
            const features = flowToFeatures(flow);
            addTrainingSample(deviceId, features);
        }).catch(() => { });

        // Feed to LSTM
        import("./ml/lstm-detector").then(({ addTimestep }) => {
            addTimestep(deviceId, {
                bytes: flow.bytes,
                protocol: flow.destPort <= 443 ? flow.destPort / 443 : 0.5,
                destPort: flow.destPort,
                hour: flow.timestamp.getHours() / 24,
                connectionCount: learning.flows.length,
            });
        }).catch(() => { });
    }
}

/**
 * Check if a device is currently learning
 */
export function isDeviceLearning(deviceId: number): boolean {
    return learningDevices.has(deviceId);
}

/**
 * Get learning progress for a device (0-1 range)
 */
export function getLearningProgress(deviceId: number): number {
    const learning = learningDevices.get(deviceId);
    if (!learning) return 1; // Return 1 (100%) if not in memory

    const elapsed = Date.now() - learning.startedAt.getTime();
    return Math.min(1, elapsed / learning.durationMs);
}

/**
 * Get learning progress from database (for devices with status monitoring/learning)
 */
export async function getLearningProgressFromDb(deviceId: number): Promise<number> {
    const baseline = await getDeviceBaseline(deviceId);
    if (!baseline || baseline.isComplete === 1) return 1;

    const startedAt = new Date(baseline.learningStartedAt).getTime();
    const durationMs = (baseline as any).learningDurationMs || 3600000;
    const elapsed = Date.now() - startedAt;

    return Math.min(1, elapsed / durationMs);
}
/**
 * Restore active learning sessions from database on server startup
 * After a power outage or restart, in-memory flows are lost, so we restart 
 * learning from the beginning with the full original duration to be safe.
 */
export async function restoreActiveLearning(): Promise<void> {
    console.log("[BaselineService] Restoring active learning sessions...");

    // Find all incomplete baselines
    const incompleteBaselines = await db.select()
        .from(deviceBaselines)
        .where(eq(deviceBaselines.isComplete, 0));

    let restarted = 0;

    for (const baseline of incompleteBaselines) {
        const durationMs = (baseline as any).learningDurationMs || 3600000;

        // Get the device to restart learning properly
        const device = await storage.getDevice(baseline.deviceId);
        if (!device) {
            console.log(`[BaselineService] Device ${baseline.deviceId} not found, skipping`);
            continue;
        }

        // Restart learning from the beginning with full duration
        // (flows from before the restart are lost, so start fresh)
        console.log(`[BaselineService] Restarting learning for ${device.name} from beginning (${Math.round(durationMs / 60000)}min)`);

        // Reset the baseline record
        await db.update(deviceBaselines)
            .set({
                learningStartedAt: new Date(),
                learningCompletedAt: null,
                flowsAnalyzed: 0,
            })
            .where(eq(deviceBaselines.deviceId, baseline.deviceId));

        // Initialize fresh in-memory tracking
        learningDevices.set(baseline.deviceId, {
            startedAt: new Date(),
            durationMs,
            flows: [],
        });

        // Schedule completion with full duration
        setTimeout(async () => {
            await completeBaselineLearning(baseline.deviceId);
        }, durationMs);

        restarted++;
    }

    console.log(`[BaselineService] Restarted ${restarted} learning sessions from beginning`);
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

    // Train ML models
    try {
        const { trainForest, getForestSummary } = require("./ml/isolation-forest");
        const trained = trainForest(deviceId);
        if (trained) {
            const summary = getForestSummary(deviceId);
            console.log(`[BaselineService] Isolation Forest trained: ${summary.numTrees} trees`);
        }
    } catch (err) {
        console.log(`[BaselineService] Isolation Forest training skipped:`, err);
    }

    try {
        const { trainLSTM, getLSTMSummary } = require("./ml/lstm-detector");
        const trained = await trainLSTM(deviceId);
        if (trained) {
            const summary = getLSTMSummary(deviceId);
            console.log(`[BaselineService] LSTM trained: ${summary.sequenceCount} sequences, loss=${summary.lastLoss}`);
        }
    } catch (err) {
        console.log(`[BaselineService] LSTM training skipped:`, err);
    }

    // Save AI models to database for persistence
    try {
        await saveAIModelsToDatabase(deviceId);
        console.log(`[BaselineService] AI models saved to database`);
    } catch (err) {
        console.log(`[BaselineService] Failed to save AI models:`, err);
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
 * Get alert severity from AI anomaly score
 */
export function getSeverityFromAIScore(score: number): "low" | "medium" | "high" | "critical" {
    if (score >= 0.8) return "critical";
    if (score >= 0.65) return "high";
    if (score >= 0.5) return "medium";
    return "low";
}

/**
 * Create an anomaly alert for a device
 */
export async function createAnomalyAlert(
    device: Device,
    anomalyType: string,
    description: string,
    aiScore?: number
): Promise<void> {
    // Determine severity from AI score if provided, otherwise medium
    const severity = aiScore !== undefined ? getSeverityFromAIScore(aiScore) : "medium";
    const anomalyScore = aiScore !== undefined ? aiScore : 0.5;

    await storage.createAlert({
        deviceId: device.id,
        deviceName: device.name,
        timestamp: new Date(),
        anomalyType,
        severity,
        status: "open",
        anomalyScore,
        description,
    });

    console.log(`[BaselineService] Alert created for ${device.name}: ${anomalyType} (severity: ${severity}, score: ${anomalyScore.toFixed(2)})`);
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

/**
 * Save AI models to database for persistence across server restarts
 */
async function saveAIModelsToDatabase(deviceId: number): Promise<void> {
    const { exportModel } = await import("./ai-anomaly-detector");
    const { getForestSummary } = await import("./ml/isolation-forest");

    const aiModels: any = {};

    // Export statistical model
    try {
        aiModels.statistical = exportModel(deviceId);
    } catch { }

    // Export Isolation Forest summary (trees are too large to store)
    try {
        const ifSummary = getForestSummary(deviceId);
        aiModels.isolationForest = { trained: ifSummary.trained, numTrees: ifSummary.numTrees };
    } catch { }

    // Update database with serialized models
    await db.update(deviceBaselines)
        .set({ aiModels })
        .where(eq(deviceBaselines.deviceId, deviceId));

    // Also save to file (in addition to database - doesn't break persistence)
    await saveModelsToFile(deviceId, aiModels);
}

/**
 * Save models to files in models/ folder
 */
async function saveModelsToFile(deviceId: number, aiModels: any): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    const modelsDir = path.join(process.cwd(), "models");

    // Ensure models directory exists
    try {
        await fs.mkdir(modelsDir, { recursive: true });
    } catch { }

    // Save statistical model as JSON
    if (aiModels.statistical) {
        const filename = path.join(modelsDir, `device_${deviceId}_statistical.json`);
        await fs.writeFile(filename, JSON.stringify(aiModels.statistical, null, 2));
        console.log(`[BaselineService] Saved statistical model to ${filename}`);
    }

    // Save combined model info
    const combinedFilename = path.join(modelsDir, `device_${deviceId}_model.json`);
    const modelInfo = {
        deviceId,
        exportedAt: new Date().toISOString(),
        models: {
            statistical: aiModels.statistical ? "included" : "not_trained",
            isolationForest: aiModels.isolationForest?.trained ? "trained" : "not_trained",
        },
        data: aiModels,
    };
    await fs.writeFile(combinedFilename, JSON.stringify(modelInfo, null, 2));
    console.log(`[BaselineService] Saved model info to ${combinedFilename}`);
}

/**
 * Load AI models from database on server startup
 */
export async function loadAIModelsFromDatabase(): Promise<void> {
    console.log("[BaselineService] Loading AI models from database...");

    const baselines = await db.select().from(deviceBaselines).where(eq(deviceBaselines.isComplete, 1));
    let loadedCount = 0;

    for (const baseline of baselines) {
        if (baseline.aiModels) {
            try {
                const { importModel } = await import("./ai-anomaly-detector");
                const models = baseline.aiModels as any;

                if (models.statistical) {
                    // The statistical model already contains deviceId, pass it directly
                    importModel(models.statistical);
                    loadedCount++;
                    console.log(`[BaselineService] Loaded AI model for device ${baseline.deviceId}`);
                }
            } catch (err) {
                console.log(`[BaselineService] Failed to load model for device ${baseline.deviceId}:`, err);
            }
        }
    }

    console.log(`[BaselineService] Loaded ${loadedCount} AI models from database`);
}

