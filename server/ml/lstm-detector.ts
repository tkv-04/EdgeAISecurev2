/**
 * LSTM Autoencoder - Sequence-based Anomaly Detection
 * 
 * Implements an LSTM autoencoder for edge ML:
 * - Learns to reconstruct normal traffic sequences
 * - High reconstruction error = anomaly
 * - Uses TensorFlow.js for Pi-optimized inference
 * 
 * NOTE: TensorFlow.js requires native bindings which may not be available
 * on all platforms (especially Raspberry Pi ARM). This module gracefully
 * degrades when TensorFlow is unavailable.
 */

// Lazy-load TensorFlow to avoid crashing on platforms without native bindings
let tf: any = null;
let tensorflowAvailable = false;

async function loadTensorFlow(): Promise<boolean> {
    if (tf !== null) return tensorflowAvailable;

    try {
        // Try pure JS version first (slower but more compatible)
        tf = await import("@tensorflow/tfjs");
        tensorflowAvailable = true;
        console.log("[LSTM] TensorFlow.js loaded (pure JS backend)");
        return true;
    } catch (e1) {
        try {
            // Try native version
            tf = await import("@tensorflow/tfjs-node");
            tensorflowAvailable = true;
            console.log("[LSTM] TensorFlow.js loaded (native backend)");
            return true;
        } catch (e2) {
            console.log("[LSTM] TensorFlow.js not available - LSTM model disabled");
            tensorflowAvailable = false;
            return false;
        }
    }
}

// Configuration
const SEQUENCE_LENGTH = 10;          // Number of timesteps
const FEATURE_COUNT = 5;             // Features per timestep
const ENCODING_DIM = 16;             // Latent dimension
const EPOCHS = 50;                   // Training epochs
const BATCH_SIZE = 32;               // Training batch size
const ANOMALY_THRESHOLD = 0.1;       // Reconstruction error threshold

/**
 * Feature vector for a single timestep
 */
export interface TimeStepFeatures {
    bytes: number;          // Normalized 0-1
    protocol: number;       // 0-1 (encoded)
    destPort: number;       // Normalized 0-1
    hour: number;           // 0-1 (hour/24)
    connectionCount: number; // Normalized 0-1
}

/**
 * LSTM model for a device
 */
export interface LSTMModel {
    deviceId: number;
    model: any | null;  // tf.LayersModel
    trained: boolean;
    trainingData: TimeStepFeatures[][];  // Sequences of features
    currentSequence: TimeStepFeatures[]; // Building current sequence
    normalization: {
        bytesMax: number;
        portMax: number;
        connMax: number;
    };
    lastTrainingLoss: number;
}

// Store models per device
const lstmModels = new Map<number, LSTMModel>();


/**
 * Initialize LSTM model for a device
 */
export function initLSTM(deviceId: number): LSTMModel {
    const model: LSTMModel = {
        deviceId,
        model: null,
        trained: false,
        trainingData: [],
        currentSequence: [],
        normalization: {
            bytesMax: 10000,
            portMax: 65535,
            connMax: 100,
        },
        lastTrainingLoss: 0,
    };

    lstmModels.set(deviceId, model);
    return model;
}

/**
 * Get or create LSTM model
 */
export function getLSTM(deviceId: number): LSTMModel {
    let model = lstmModels.get(deviceId);
    if (!model) {
        model = initLSTM(deviceId);
    }
    return model;
}

/**
 * Normalize features to 0-1 range
 */
function normalizeFeatures(
    features: TimeStepFeatures,
    norm: LSTMModel["normalization"]
): number[] {
    return [
        Math.min(1, features.bytes / norm.bytesMax),
        features.protocol / 11,  // Max protocol code is 11
        features.destPort / norm.portMax,
        features.hour / 24,
        Math.min(1, features.connectionCount / norm.connMax),
    ];
}

/**
 * Add a timestep observation
 */
export function addTimestep(deviceId: number, features: TimeStepFeatures): void {
    const model = getLSTM(deviceId);

    // Update normalization ranges
    model.normalization.bytesMax = Math.max(model.normalization.bytesMax, features.bytes * 1.5);
    model.normalization.connMax = Math.max(model.normalization.connMax, features.connectionCount * 1.5);

    // Add to current sequence
    model.currentSequence.push(features);

    // When sequence is complete, save it and start new one
    if (model.currentSequence.length >= SEQUENCE_LENGTH) {
        model.trainingData.push([...model.currentSequence]);
        model.currentSequence = model.currentSequence.slice(-Math.floor(SEQUENCE_LENGTH / 2));  // Overlap
    }
}

/**
 * Build the LSTM autoencoder architecture
 */
function buildModel(): any {
    if (!tf) return null;

    const model = tf.sequential();

    // Encoder
    model.add(tf.layers.lstm({
        units: 32,
        inputShape: [SEQUENCE_LENGTH, FEATURE_COUNT],
        returnSequences: true,
    }));

    model.add(tf.layers.lstm({
        units: ENCODING_DIM,
        returnSequences: false,
    }));

    // Decoder
    model.add(tf.layers.repeatVector({ n: SEQUENCE_LENGTH }));

    model.add(tf.layers.lstm({
        units: ENCODING_DIM,
        returnSequences: true,
    }));

    model.add(tf.layers.lstm({
        units: 32,
        returnSequences: true,
    }));

    model.add(tf.layers.timeDistributed({
        layer: tf.layers.dense({ units: FEATURE_COUNT }),
    }));

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "meanSquaredError",
    });

    return model;
}

/**
 * Train the LSTM autoencoder
 */
export async function trainLSTM(deviceId: number): Promise<boolean> {
    // Check if TensorFlow is available
    const available = await loadTensorFlow();
    if (!available) {
        console.log(`[LSTM] TensorFlow not available - skipping LSTM training for device ${deviceId}`);
        return false;
    }

    const lstmModel = getLSTM(deviceId);

    if (lstmModel.trainingData.length < 10) {
        console.log(`[LSTM] Device ${deviceId}: Not enough sequences (${lstmModel.trainingData.length})`);
        return false;
    }

    console.log(`[LSTM] Training for device ${deviceId} with ${lstmModel.trainingData.length} sequences`);

    try {
        // Build model if not exists
        if (!lstmModel.model) {
            lstmModel.model = buildModel();
            if (!lstmModel.model) {
                console.log(`[LSTM] Failed to build model for device ${deviceId}`);
                return false;
            }
        }

        // Prepare training data
        const sequences = lstmModel.trainingData.map(seq =>
            seq.map(features => normalizeFeatures(features, lstmModel.normalization))
        );

        const xs = tf.tensor3d(sequences);

        // Train autoencoder (input = output for reconstruction)
        const history = await lstmModel.model.fit(xs, xs, {
            epochs: EPOCHS,
            batchSize: BATCH_SIZE,
            shuffle: true,
            verbose: 0,
        });

        lstmModel.lastTrainingLoss = history.history.loss[history.history.loss.length - 1] as number;
        lstmModel.trained = true;

        // Cleanup
        xs.dispose();

        console.log(`[LSTM] Device ${deviceId}: Training complete, loss=${lstmModel.lastTrainingLoss.toFixed(6)}`);
        return true;

    } catch (error) {
        console.error(`[LSTM] Training failed for device ${deviceId}:`, error);
        return false;
    }
}

/**
 * Calculate reconstruction error for a sequence
 */
export function reconstructionError(deviceId: number, sequence: TimeStepFeatures[]): number {
    // TensorFlow must be loaded for this to work
    if (!tf || !tensorflowAvailable) {
        return 0;
    }

    const lstmModel = lstmModels.get(deviceId);

    if (!lstmModel || !lstmModel.model || !lstmModel.trained) {
        return 0;
    }

    if (sequence.length !== SEQUENCE_LENGTH) {
        return 0;
    }

    try {
        // Normalize sequence
        const normalized = sequence.map(f => normalizeFeatures(f, lstmModel.normalization));

        // Create input tensor
        const input = tf.tensor3d([normalized]);

        // Get reconstruction
        const reconstruction = lstmModel.model.predict(input) as tf.Tensor;

        // Calculate MSE
        const mse = tf.losses.meanSquaredError(input, reconstruction).dataSync()[0];

        // Cleanup
        input.dispose();
        reconstruction.dispose();

        return mse;

    } catch (error) {
        console.error(`[LSTM] Reconstruction error failed:`, error);
        return 0;
    }
}

/**
 * Check if current sequence is anomalous
 */
export function detectAnomaly(deviceId: number): {
    isAnomaly: boolean;
    reconstructionError: number;
    threshold: number;
} {
    const lstmModel = lstmModels.get(deviceId);

    if (!lstmModel || !lstmModel.trained || lstmModel.currentSequence.length < SEQUENCE_LENGTH) {
        return {
            isAnomaly: false,
            reconstructionError: 0,
            threshold: ANOMALY_THRESHOLD,
        };
    }

    // Get the most recent complete sequence
    const sequence = lstmModel.currentSequence.slice(-SEQUENCE_LENGTH);
    const error = reconstructionError(deviceId, sequence);

    // Adjust threshold based on training loss
    const dynamicThreshold = Math.max(ANOMALY_THRESHOLD, lstmModel.lastTrainingLoss * 3);

    return {
        isAnomaly: error > dynamicThreshold,
        reconstructionError: error,
        threshold: dynamicThreshold,
    };
}

/**
 * Get LSTM model summary
 */
export function getLSTMSummary(deviceId: number): {
    trained: boolean;
    sequenceCount: number;
    currentSequenceLength: number;
    lastLoss: number;
} {
    const model = lstmModels.get(deviceId);

    if (!model) {
        return {
            trained: false,
            sequenceCount: 0,
            currentSequenceLength: 0,
            lastLoss: 0,
        };
    }

    return {
        trained: model.trained,
        sequenceCount: model.trainingData.length,
        currentSequenceLength: model.currentSequence.length,
        lastLoss: model.lastTrainingLoss,
    };
}

/**
 * Clear LSTM model for a device
 */
export function clearLSTM(deviceId: number): void {
    const model = lstmModels.get(deviceId);
    if (model?.model) {
        model.model.dispose();
    }
    lstmModels.delete(deviceId);
}

/**
 * Save model to file (for persistence)
 */
export async function saveModel(deviceId: number, path: string): Promise<boolean> {
    const lstmModel = lstmModels.get(deviceId);
    if (!lstmModel?.model) return false;

    try {
        await lstmModel.model.save(`file://${path}`);
        return true;
    } catch (error) {
        console.error(`[LSTM] Failed to save model:`, error);
        return false;
    }
}

/**
 * Load model from file
 */
export async function loadModel(deviceId: number, path: string): Promise<boolean> {
    try {
        const model = await tf.loadLayersModel(`file://${path}/model.json`);
        const lstmModel = getLSTM(deviceId);
        lstmModel.model = model;
        lstmModel.trained = true;
        return true;
    } catch (error) {
        console.error(`[LSTM] Failed to load model:`, error);
        return false;
    }
}
