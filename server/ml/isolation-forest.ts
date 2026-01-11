/**
 * Isolation Forest - Unsupervised Anomaly Detection
 * 
 * Implements the Isolation Forest algorithm for edge ML:
 * - Anomalies are isolated with fewer partitions
 * - No labels needed (unsupervised)
 * - Lightweight and fast for Pi
 * 
 * Reference: Liu, Ting, Zhou (2008) "Isolation Forest"
 */

// Configuration
const DEFAULT_NUM_TREES = 100;
const DEFAULT_SAMPLE_SIZE = 256;
const EULER_CONSTANT = 0.5772156649;

/**
 * Feature vector for a flow observation
 */
export interface FlowFeatures {
    bytes: number;
    protocol: number;      // Encoded: TCP=0, UDP=1, HTTP=2, etc.
    destPort: number;
    hour: number;          // 0-23
    dayOfWeek: number;     // 0-6
}

/**
 * Node in an isolation tree
 */
interface ITreeNode {
    isLeaf: boolean;
    size: number;
    splitFeature?: number;  // Feature index to split on
    splitValue?: number;    // Split threshold
    left?: ITreeNode;
    right?: ITreeNode;
}

/**
 * An isolation tree
 */
interface ITree {
    root: ITreeNode;
    heightLimit: number;
}

/**
 * Isolation Forest model
 */
export interface IsolationForestModel {
    deviceId: number;
    trees: ITree[];
    numTrees: number;
    sampleSize: number;
    featureRanges: Array<{ min: number; max: number }>;
    trained: boolean;
    trainingData: FlowFeatures[];
}

// Store models per device
const forestModels = new Map<number, IsolationForestModel>();

/**
 * Encode protocol string to number
 */
export function encodeProtocol(protocol: string): number {
    const protocols: Record<string, number> = {
        'tcp': 0, 'udp': 1, 'http': 2, 'https': 3, 'dns': 4,
        'mqtt': 5, 'ssh': 6, 'ftp': 7, 'smtp': 8, 'icmp': 9,
        'failed': 10, 'unknown': 11,
    };
    return protocols[protocol.toLowerCase()] ?? 11;
}

/**
 * Convert flow to feature vector
 */
export function flowToFeatures(flow: {
    bytes: number;
    protocol: string;
    destPort: number;
    timestamp: Date;
}): FlowFeatures {
    return {
        bytes: flow.bytes,
        protocol: encodeProtocol(flow.protocol),
        destPort: flow.destPort,
        hour: flow.timestamp.getHours(),
        dayOfWeek: flow.timestamp.getDay(),
    };
}

/**
 * Initialize a new Isolation Forest model
 */
export function initForest(
    deviceId: number,
    numTrees: number = DEFAULT_NUM_TREES,
    sampleSize: number = DEFAULT_SAMPLE_SIZE
): IsolationForestModel {
    const model: IsolationForestModel = {
        deviceId,
        trees: [],
        numTrees,
        sampleSize,
        featureRanges: [
            { min: 0, max: 10000 },    // bytes
            { min: 0, max: 11 },       // protocol
            { min: 0, max: 65535 },    // destPort
            { min: 0, max: 23 },       // hour
            { min: 0, max: 6 },        // dayOfWeek
        ],
        trained: false,
        trainingData: [],
    };

    forestModels.set(deviceId, model);
    return model;
}

/**
 * Get or create a forest model
 */
export function getForest(deviceId: number): IsolationForestModel {
    let model = forestModels.get(deviceId);
    if (!model) {
        model = initForest(deviceId);
    }
    return model;
}

/**
 * Add training sample to model
 */
export function addTrainingSample(deviceId: number, features: FlowFeatures): void {
    const model = getForest(deviceId);
    model.trainingData.push(features);

    // Update feature ranges for normalization
    model.featureRanges[0].min = Math.min(model.featureRanges[0].min, features.bytes);
    model.featureRanges[0].max = Math.max(model.featureRanges[0].max, features.bytes);
    model.featureRanges[2].min = Math.min(model.featureRanges[2].min, features.destPort);
    model.featureRanges[2].max = Math.max(model.featureRanges[2].max, features.destPort);
}

/**
 * Random sampling with replacement
 */
function sampleWithReplacement<T>(data: T[], sampleSize: number): T[] {
    const sample: T[] = [];
    for (let i = 0; i < sampleSize; i++) {
        const idx = Math.floor(Math.random() * data.length);
        sample.push(data[idx]);
    }
    return sample;
}

/**
 * Get feature value from features array
 */
function getFeatureValue(features: FlowFeatures, featureIndex: number): number {
    const values = [features.bytes, features.protocol, features.destPort, features.hour, features.dayOfWeek];
    return values[featureIndex];
}

/**
 * Build a single isolation tree recursively
 */
function buildTree(
    data: FlowFeatures[],
    currentHeight: number,
    heightLimit: number,
    featureRanges: Array<{ min: number; max: number }>
): ITreeNode {
    // Leaf conditions
    if (currentHeight >= heightLimit || data.length <= 1) {
        return { isLeaf: true, size: data.length };
    }

    // Randomly select feature and split value
    const numFeatures = 5;
    const splitFeature = Math.floor(Math.random() * numFeatures);
    const range = featureRanges[splitFeature];
    const splitValue = range.min + Math.random() * (range.max - range.min);

    // Split data
    const left: FlowFeatures[] = [];
    const right: FlowFeatures[] = [];

    for (const point of data) {
        const value = getFeatureValue(point, splitFeature);
        if (value < splitValue) {
            left.push(point);
        } else {
            right.push(point);
        }
    }

    // If split is ineffective, make leaf
    if (left.length === 0 || right.length === 0) {
        return { isLeaf: true, size: data.length };
    }

    return {
        isLeaf: false,
        size: data.length,
        splitFeature,
        splitValue,
        left: buildTree(left, currentHeight + 1, heightLimit, featureRanges),
        right: buildTree(right, currentHeight + 1, heightLimit, featureRanges),
    };
}

/**
 * Train the Isolation Forest
 */
export function trainForest(deviceId: number): boolean {
    const model = getForest(deviceId);

    if (model.trainingData.length < 10) {
        console.log(`[IsolationForest] Device ${deviceId}: Not enough data (${model.trainingData.length})`);
        return false;
    }

    console.log(`[IsolationForest] Training for device ${deviceId} with ${model.trainingData.length} samples`);

    // Calculate height limit based on sample size
    const sampleSize = Math.min(model.sampleSize, model.trainingData.length);
    const heightLimit = Math.ceil(Math.log2(sampleSize));

    // Build trees
    model.trees = [];
    for (let i = 0; i < model.numTrees; i++) {
        const sample = sampleWithReplacement(model.trainingData, sampleSize);
        const tree: ITree = {
            root: buildTree(sample, 0, heightLimit, model.featureRanges),
            heightLimit,
        };
        model.trees.push(tree);
    }

    model.trained = true;
    console.log(`[IsolationForest] Device ${deviceId}: Trained ${model.numTrees} trees`);
    return true;
}

/**
 * Calculate path length for a point in a tree
 */
function pathLength(
    features: FlowFeatures,
    node: ITreeNode,
    currentHeight: number
): number {
    if (node.isLeaf) {
        // Add c(n) adjustment for leaf nodes
        return currentHeight + cFactor(node.size);
    }

    const value = getFeatureValue(features, node.splitFeature!);

    if (value < node.splitValue!) {
        return pathLength(features, node.left!, currentHeight + 1);
    } else {
        return pathLength(features, node.right!, currentHeight + 1);
    }
}

/**
 * C(n) factor from the original paper
 * Average path length of unsuccessful search in BST
 */
function cFactor(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    return 2 * (Math.log(n - 1) + EULER_CONSTANT) - (2 * (n - 1) / n);
}

/**
 * Calculate anomaly score for a point (0 to 1)
 * Higher score = more anomalous
 */
export function anomalyScore(deviceId: number, features: FlowFeatures): number {
    const model = forestModels.get(deviceId);

    if (!model || !model.trained || model.trees.length === 0) {
        return 0;  // No model, can't score
    }

    // Calculate average path length across all trees
    let totalPathLength = 0;
    for (const tree of model.trees) {
        totalPathLength += pathLength(features, tree.root, 0);
    }
    const avgPathLength = totalPathLength / model.trees.length;

    // Normalize to anomaly score (0 to 1)
    // Score = 2^(-avgPathLength / c(n))
    const c = cFactor(model.sampleSize);
    const score = Math.pow(2, -avgPathLength / c);

    return score;
}

/**
 * Check if a flow is anomalous
 */
export function isAnomaly(
    deviceId: number,
    features: FlowFeatures,
    threshold: number = 0.6
): { isAnomaly: boolean; score: number } {
    const score = anomalyScore(deviceId, features);
    return {
        isAnomaly: score > threshold,
        score,
    };
}

/**
 * Get model summary
 */
export function getForestSummary(deviceId: number): {
    trained: boolean;
    numTrees: number;
    trainingSamples: number;
} {
    const model = forestModels.get(deviceId);
    if (!model) {
        return { trained: false, numTrees: 0, trainingSamples: 0 };
    }

    return {
        trained: model.trained,
        numTrees: model.trees.length,
        trainingSamples: model.trainingData.length,
    };
}

/**
 * Clear a device's model
 */
export function clearForest(deviceId: number): void {
    forestModels.delete(deviceId);
}
