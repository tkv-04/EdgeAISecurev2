/**
 * Edge AI Anomaly Detector
 * 
 * Implements multi-model anomaly detection:
 * - Statistical learning (Z-Score, entropy)
 * - Isolation Forest (unsupervised)
 * - LSTM Autoencoder (sequence-based)
 * - Ensemble scoring for robust detection
 */

import type { DeviceBaseline } from "@shared/schema";

// Anomaly detection thresholds
const Z_SCORE_THRESHOLD = 2.5;  // Flag values > 2.5 standard deviations
const ENTROPY_THRESHOLD = 0.7;   // High entropy = suspicious
const MIN_SAMPLES = 10;          // Minimum samples for reliable statistics

// Weights for composite anomaly score (ensemble)
const WEIGHTS = {
    statistical: 0.40,    // Statistical analysis weight
    isolationForest: 0.35, // Isolation Forest weight
    lstm: 0.25,           // LSTM weight (when available)
};

// Sub-weights for statistical component
const STAT_WEIGHTS = {
    traffic: 0.30,
    protocol: 0.30,
    destination: 0.20,
    timePattern: 0.20,
};

/**
 * Statistical model for a device's learned behavior
 */
export interface DeviceBehaviorModel {
    deviceId: number;

    // Traffic statistics
    trafficMean: number;
    trafficStdDev: number;
    trafficMin: number;
    trafficMax: number;
    trafficSamples: number;

    // Hourly traffic patterns (24 hours)
    hourlyMeans: number[];      // [hour 0-23] -> mean traffic
    hourlyStdDevs: number[];    // [hour 0-23] -> std dev
    hourlySamples: number[];    // [hour 0-23] -> sample count

    // Protocol distribution (learned baseline)
    protocolDistribution: Map<string, number>;  // protocol -> percentage

    // Destination statistics
    knownDestinations: Set<string>;
    destinationFrequency: Map<string, number>;  // destination -> count

    // Connection patterns
    connectionMean: number;
    connectionStdDev: number;
}

/**
 * Result of anomaly analysis (ensemble)
 */
export interface AnomalyAnalysis {
    isAnomaly: boolean;
    anomalyScore: number;       // 0.0 - 1.0
    confidence: number;         // 0.0 - 1.0 (based on data quality)
    components: {
        trafficScore: number;
        protocolScore: number;
        destinationScore: number;
        timePatternScore: number;
    };
    mlScores: {
        statisticalScore: number;
        isolationForestScore: number;
        lstmScore: number;
    };
    reasons: string[];
}

// In-memory behavior models per device
const behaviorModels = new Map<number, DeviceBehaviorModel>();

/**
 * Initialize a new behavior model for a device
 */
export function initBehaviorModel(deviceId: number): DeviceBehaviorModel {
    const model: DeviceBehaviorModel = {
        deviceId,
        trafficMean: 0,
        trafficStdDev: 0,
        trafficMin: Infinity,
        trafficMax: 0,
        trafficSamples: 0,
        hourlyMeans: new Array(24).fill(0),
        hourlyStdDevs: new Array(24).fill(0),
        hourlySamples: new Array(24).fill(0),
        protocolDistribution: new Map(),
        knownDestinations: new Set(),
        destinationFrequency: new Map(),
        connectionMean: 0,
        connectionStdDev: 0,
    };

    behaviorModels.set(deviceId, model);
    return model;
}

/**
 * Get or create a behavior model for a device
 */
export function getBehaviorModel(deviceId: number): DeviceBehaviorModel {
    let model = behaviorModels.get(deviceId);
    if (!model) {
        model = initBehaviorModel(deviceId);
    }
    return model;
}

/**
 * Update running statistics using Welford's online algorithm
 * Allows incremental mean/std dev calculation without storing all values
 */
function updateRunningStats(
    currentMean: number,
    currentStdDev: number,
    currentCount: number,
    newValue: number
): { mean: number; stdDev: number; count: number } {
    const count = currentCount + 1;
    const delta = newValue - currentMean;
    const mean = currentMean + delta / count;

    // Update variance using Welford's algorithm
    const delta2 = newValue - mean;
    const m2 = (currentStdDev * currentStdDev * currentCount) + delta * delta2;
    const variance = count > 1 ? m2 / (count - 1) : 0;
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev, count };
}

/**
 * Add a flow observation to the behavior model (during learning)
 */
export function addFlowObservation(
    deviceId: number,
    flow: {
        bytes: number;
        protocol: string;
        destIp: string;
        timestamp: Date;
    }
): void {
    const model = getBehaviorModel(deviceId);

    // Update traffic statistics
    const trafficStats = updateRunningStats(
        model.trafficMean,
        model.trafficStdDev,
        model.trafficSamples,
        flow.bytes
    );
    model.trafficMean = trafficStats.mean;
    model.trafficStdDev = trafficStats.stdDev;
    model.trafficSamples = trafficStats.count;
    model.trafficMin = Math.min(model.trafficMin, flow.bytes);
    model.trafficMax = Math.max(model.trafficMax, flow.bytes);

    // Update hourly patterns
    const hour = flow.timestamp.getHours();
    const hourlyStats = updateRunningStats(
        model.hourlyMeans[hour],
        model.hourlyStdDevs[hour],
        model.hourlySamples[hour],
        flow.bytes
    );
    model.hourlyMeans[hour] = hourlyStats.mean;
    model.hourlyStdDevs[hour] = hourlyStats.stdDev;
    model.hourlySamples[hour] = hourlyStats.count;

    // Update protocol distribution
    const currentProtoCount = model.protocolDistribution.get(flow.protocol) || 0;
    model.protocolDistribution.set(flow.protocol, currentProtoCount + 1);

    // Update destination tracking
    model.knownDestinations.add(flow.destIp);
    const currentDestCount = model.destinationFrequency.get(flow.destIp) || 0;
    model.destinationFrequency.set(flow.destIp, currentDestCount + 1);
}

/**
 * Calculate Z-Score for a value
 */
function calculateZScore(value: number, mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
}

/**
 * Calculate Shannon entropy for destination diversity
 * High entropy = many diverse destinations = potentially suspicious
 */
function calculateEntropy(frequencies: Map<string, number>): number {
    const values = Array.from(frequencies.values());
    const total = values.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;

    let entropy = 0;
    for (const count of values) {
        const p = count / total;
        if (p > 0) {
            entropy -= p * Math.log2(p);
        }
    }

    // Normalize to 0-1 range (divide by max possible entropy)
    const maxEntropy = Math.log2(frequencies.size);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Analyze a flow for anomalies using the learned model
 */
export function analyzeFlow(
    deviceId: number,
    flow: {
        bytes: number;
        protocol: string;
        destIp: string;
        timestamp: Date;
    }
): AnomalyAnalysis {
    const model = behaviorModels.get(deviceId);

    // If no model exists, can't detect anomalies
    if (!model || model.trafficSamples < MIN_SAMPLES) {
        return {
            isAnomaly: false,
            anomalyScore: 0,
            confidence: 0,
            components: {
                trafficScore: 0,
                protocolScore: 0,
                destinationScore: 0,
                timePatternScore: 0,
            },
            mlScores: {
                statisticalScore: 0,
                isolationForestScore: 0,
                lstmScore: 0,
            },
            reasons: ["Insufficient data for analysis"],
        };
    }

    const reasons: string[] = [];

    // 1. Traffic Z-Score Analysis
    const trafficZScore = calculateZScore(flow.bytes, model.trafficMean, model.trafficStdDev);
    const trafficScore = Math.min(1, Math.abs(trafficZScore) / (Z_SCORE_THRESHOLD * 2));
    if (Math.abs(trafficZScore) > Z_SCORE_THRESHOLD) {
        reasons.push(`Traffic deviation: ${trafficZScore.toFixed(1)}σ from mean`);
    }

    // 2. Protocol Analysis
    let protocolScore = 0;
    const totalProtoFlows = Array.from(model.protocolDistribution.values()).reduce((a, b) => a + b, 0);
    const protoPercent = ((model.protocolDistribution.get(flow.protocol) || 0) / totalProtoFlows) * 100;

    if (!model.protocolDistribution.has(flow.protocol)) {
        protocolScore = 1.0;  // Completely new protocol
        reasons.push(`New protocol detected: ${flow.protocol}`);
    } else if (protoPercent < 1) {
        protocolScore = 0.7;  // Very rare protocol
        reasons.push(`Rare protocol: ${flow.protocol} (${protoPercent.toFixed(1)}% of baseline)`);
    }

    // 3. Destination Analysis
    let destinationScore = 0;
    if (!model.knownDestinations.has(flow.destIp)) {
        // New destination - check if device typically contacts few destinations
        const destCount = model.knownDestinations.size;
        if (destCount < 20) {
            destinationScore = 0.8;  // Device has limited destinations, new one is suspicious
            reasons.push(`New destination: ${flow.destIp} (baseline has ${destCount} known destinations)`);
        } else {
            destinationScore = 0.3;  // Device contacts many destinations, less suspicious
        }
    }

    // 4. Time Pattern Analysis
    const hour = flow.timestamp.getHours();
    let timePatternScore = 0;
    if (model.hourlySamples[hour] >= 3) {
        const hourlyZScore = calculateZScore(flow.bytes, model.hourlyMeans[hour], model.hourlyStdDevs[hour]);
        timePatternScore = Math.min(1, Math.abs(hourlyZScore) / (Z_SCORE_THRESHOLD * 2));

        if (Math.abs(hourlyZScore) > Z_SCORE_THRESHOLD) {
            reasons.push(`Unusual activity for hour ${hour}: ${hourlyZScore.toFixed(1)}σ`);
        }
    } else if (model.hourlySamples[hour] === 0) {
        // No activity at this hour during baseline
        timePatternScore = 0.6;
        reasons.push(`Activity at unusual hour: ${hour}:00 (no baseline data)`);
    }

    // Calculate statistical anomaly score
    const statisticalScore =
        STAT_WEIGHTS.traffic * trafficScore +
        STAT_WEIGHTS.protocol * protocolScore +
        STAT_WEIGHTS.destination * destinationScore +
        STAT_WEIGHTS.timePattern * timePatternScore;

    // Try to get ML model scores (if available)
    let isolationForestScore = 0;
    let lstmScore = 0;

    try {
        const { flowToFeatures, anomalyScore: ifScore } = require("./ml/isolation-forest");
        const features = flowToFeatures(flow);
        isolationForestScore = ifScore(deviceId, features);
    } catch {
        // Isolation Forest not available or not trained
    }

    try {
        const { detectAnomaly } = require("./ml/lstm-detector");
        const lstmResult = detectAnomaly(deviceId);
        lstmScore = lstmResult.reconstructionError / (lstmResult.threshold * 2);
        lstmScore = Math.min(1, lstmScore);
    } catch {
        // LSTM not available or not trained
    }

    // Ensemble scoring
    const hasIsolationForest = isolationForestScore > 0;
    const hasLSTM = lstmScore > 0;

    let anomalyScore: number;
    if (hasIsolationForest && hasLSTM) {
        anomalyScore = WEIGHTS.statistical * statisticalScore +
            WEIGHTS.isolationForest * isolationForestScore +
            WEIGHTS.lstm * lstmScore;
    } else if (hasIsolationForest) {
        anomalyScore = 0.6 * statisticalScore + 0.4 * isolationForestScore;
    } else {
        anomalyScore = statisticalScore;
    }

    // Calculate confidence based on data quality
    const confidence = Math.min(1, model.trafficSamples / 100);  // 100 samples = full confidence

    return {
        isAnomaly: anomalyScore > 0.5,
        anomalyScore,
        confidence,
        components: {
            trafficScore,
            protocolScore,
            destinationScore,
            timePatternScore,
        },
        mlScores: {
            statisticalScore,
            isolationForestScore,
            lstmScore,
        },
        reasons,
    };
}

/**
 * Get a summary of the learned behavior model
 */
export function getModelSummary(deviceId: number): {
    hasModel: boolean;
    samples: number;
    confidence: number;
    trafficProfile: { mean: number; stdDev: number; min: number; max: number } | null;
    protocols: Array<{ protocol: string; percentage: number }>;
    destinationCount: number;
    peakHours: number[];
} {
    const model = behaviorModels.get(deviceId);

    if (!model) {
        return {
            hasModel: false,
            samples: 0,
            confidence: 0,
            trafficProfile: null,
            protocols: [],
            destinationCount: 0,
            peakHours: [],
        };
    }

    // Calculate protocol percentages
    const totalFlows = Array.from(model.protocolDistribution.values()).reduce((a, b) => a + b, 0);
    const protocols = Array.from(model.protocolDistribution.entries())
        .map(([protocol, count]) => ({
            protocol,
            percentage: totalFlows > 0 ? (count / totalFlows) * 100 : 0,
        }))
        .sort((a, b) => b.percentage - a.percentage);

    // Find peak hours (top 3 with most activity)
    const hourlyActivity = model.hourlySamples.map((samples, hour) => ({ hour, samples }));
    const peakHours = hourlyActivity
        .sort((a, b) => b.samples - a.samples)
        .slice(0, 3)
        .map(h => h.hour);

    return {
        hasModel: true,
        samples: model.trafficSamples,
        confidence: Math.min(1, model.trafficSamples / 100),
        trafficProfile: {
            mean: model.trafficMean,
            stdDev: model.trafficStdDev,
            min: model.trafficMin === Infinity ? 0 : model.trafficMin,
            max: model.trafficMax,
        },
        protocols,
        destinationCount: model.knownDestinations.size,
        peakHours,
    };
}

/**
 * Export model to JSON for persistence
 */
export function exportModel(deviceId: number): object | null {
    const model = behaviorModels.get(deviceId);
    if (!model) return null;

    return {
        deviceId: model.deviceId,
        trafficMean: model.trafficMean,
        trafficStdDev: model.trafficStdDev,
        trafficMin: model.trafficMin === Infinity ? 0 : model.trafficMin,
        trafficMax: model.trafficMax,
        trafficSamples: model.trafficSamples,
        hourlyMeans: model.hourlyMeans,
        hourlyStdDevs: model.hourlyStdDevs,
        hourlySamples: model.hourlySamples,
        protocolDistribution: Object.fromEntries(model.protocolDistribution),
        knownDestinations: Array.from(model.knownDestinations),
        destinationFrequency: Object.fromEntries(model.destinationFrequency),
        connectionMean: model.connectionMean,
        connectionStdDev: model.connectionStdDev,
    };
}

/**
 * Import model from JSON
 */
export function importModel(data: any): void {
    if (!data || !data.deviceId) return;

    const model: DeviceBehaviorModel = {
        deviceId: data.deviceId,
        trafficMean: data.trafficMean || 0,
        trafficStdDev: data.trafficStdDev || 0,
        trafficMin: data.trafficMin || Infinity,
        trafficMax: data.trafficMax || 0,
        trafficSamples: data.trafficSamples || 0,
        hourlyMeans: data.hourlyMeans || new Array(24).fill(0),
        hourlyStdDevs: data.hourlyStdDevs || new Array(24).fill(0),
        hourlySamples: data.hourlySamples || new Array(24).fill(0),
        protocolDistribution: new Map(Object.entries(data.protocolDistribution || {})),
        knownDestinations: new Set(data.knownDestinations || []),
        destinationFrequency: new Map(Object.entries(data.destinationFrequency || {})),
        connectionMean: data.connectionMean || 0,
        connectionStdDev: data.connectionStdDev || 0,
    };

    behaviorModels.set(data.deviceId, model);
}

/**
 * Clear a device's model (for re-learning)
 */
export function clearModel(deviceId: number): void {
    behaviorModels.delete(deviceId);
}

/**
 * Get all device IDs with models
 */
export function getAllModelIds(): number[] {
    return Array.from(behaviorModels.keys());
}
