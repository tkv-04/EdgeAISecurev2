# EdgeAISecure - AI Model Training Guide

## Overview

EdgeAISecure uses a **3-model ensemble** for anomaly detection:

| Model | Type | Purpose |
|-------|------|---------|
| Statistical | Supervised | Z-score, entropy-based deviation |
| Isolation Forest | Unsupervised | Outlier detection via isolation |
| LSTM Autoencoder | Deep Learning | Sequence pattern anomalies |

---

## Training Data Requirements

### Input Data: Network Flow Events

Each flow event needs:

```typescript
{
  bytes: number;        // Total bytes transferred (required)
  protocol: string;     // e.g., "TCP", "HTTPS", "MQTT" (required)
  destIp: string;       // Destination IP address (required)
  destPort: number;     // Destination port (required)
  timestamp: Date;      // When flow occurred (required)
}
```

### Data Sources in EdgeAISecure

| Source | Table/Store | Purpose |
|--------|-------------|---------|
| Suricata flows | `flow_events` | Real-time network flows |
| In-memory flows | `suricataService.deviceTraffic` | Recent flows per device |

---

## Training Process

### Phase 1: Learning Mode (Automatic)

When a device is approved, it enters **learning mode** for a configurable duration:

```
Device Approved → Learning Mode (60s default) → AI Model Trained → Monitoring Mode
```

#### What Happens During Learning:

1. **Flow Collection**: All network flows are captured
2. **Feature Extraction**: Flows → Features (bytes, protocol, port, time)
3. **Statistical Learning**: Running mean/stddev using Welford's algorithm
4. **Isolation Forest Training**: Build 100 trees from flow features
5. **LSTM Training**: Sequence patterns from flow history

### Phase 2: Monitoring Mode

After learning, the model analyzes each new flow:

```
New Flow → 3 Models Score → Ensemble Weighted Average → Anomaly Decision
```

---

## Model Details

### 1. Statistical Model (40% weight)

Learns from 4 components:

| Component | Weight | What It Learns |
|-----------|--------|----------------|
| Traffic | 30% | Mean/StdDev of bytes per flow |
| Protocol | 30% | Which protocols are normal (TCP, HTTPS, etc.) |
| Destination | 20% | Known destination IPs and their frequency |
| Time Pattern | 20% | Activity patterns by hour (0-23) |

**Data Structure:**
```typescript
DeviceBehaviorModel {
  trafficMean: number;           // Average bytes per flow
  trafficStdDev: number;         // Standard deviation
  trafficMin/Max: number;        // Range
  trafficSamples: number;        // Number of flows observed
  hourlyMeans[24]: number[];     // Traffic by hour
  protocolDistribution: Map;     // {"HTTPS": 45, "TCP": 30, ...}
  knownDestinations: Set;        // {"8.8.8.8", "api.example.com", ...}
  destinationFrequency: Map;     // How often each dest is contacted
}
```

### 2. Isolation Forest (30% weight)

Uses 5 features:

| Feature | Index | Description |
|---------|-------|-------------|
| bytes | 0 | Total bytes in flow |
| protocol | 1 | Encoded protocol (0-11) |
| destPort | 2 | Destination port number |
| hour | 3 | Hour of day (0-23) |
| dayOfWeek | 4 | Day (0-6) |

**Training Parameters:**
- Trees: 100
- Sample size: 256
- Height limit: log2(sample_size)

**Protocol Encoding:**
```typescript
tcp=0, udp=1, http=2, https=3, tls=4, 
dns=5, mqtt=6, coap=7, ssh=8, icmp=9,
quic=10, other=11
```

### 3. LSTM Autoencoder (30% weight)

Analyzes sequences of flows to detect pattern anomalies.

---

## Minimum Data Requirements

| Model | Min Samples | Recommended | Notes |
|-------|-------------|-------------|-------|
| Statistical | 10 | 100+ | Needs samples for each hour ideally |
| Isolation Forest | 256 | 500+ | Requires enough for tree building |
| LSTM | 50 | 200+ | Needs sequence history |

**Recommended Learning Duration:**
- Minimum: 60 seconds
- Recommended: 1-24 hours (captures hourly patterns)
- Best: 1-7 days (captures weekly patterns)

---

## How to Train a Device

### Option 1: Automatic (UI)

1. Go to **Devices** page
2. Select a device with status "new"
3. Click **Approve** → Device enters learning mode
4. Wait for learning to complete (see progress bar)
5. Device is now monitored with AI

### Option 2: Manual Training (API)

```bash
# Start learning for device ID 81
curl -X POST http://localhost:5000/api/devices/81/start-learning

# Check learning progress
curl http://localhost:5000/api/devices/81

# The device will have:
# - isLearning: true
# - learningProgress: 0-100
```

### Option 3: Train from Historical Data

```typescript
import { trainFromHistoricalFlows } from './ai-anomaly-detector';

// Feed historical flows
for (const flow of historicalFlows) {
  trainFromHistoricalFlows(deviceId, {
    bytes: flow.totalBytes,
    protocol: flow.protocol,
    destIp: flow.destIp,
    destPort: flow.destPort,
    timestamp: new Date(flow.timestamp)
  });
}
```

---

## Model Export/Import

### Export Model (for backup or transfer)

```typescript
import { exportModel } from './ai-anomaly-detector';

const modelData = exportModel(deviceId);
// Save to file: models/device_81_model.json
```

### Import Model

```typescript
import { importModel } from './ai-anomaly-detector';

const modelData = JSON.parse(fs.readFileSync('models/device_81_model.json'));
importModel(modelData);
```

---

## Anomaly Detection Thresholds

| Component | Threshold | Meaning |
|-----------|-----------|---------|
| Z-Score | > 2.0 | Traffic is 2+ std devs from mean |
| Protocol Entropy | > 0.5 | Unknown protocol detected |
| Destination | New IP | Never-before-seen destination |
| Isolation Score | > 0.6 | Point is easily isolated (anomaly) |
| Ensemble Score | > 0.5 | Combined score triggers alert |

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        DATA COLLECTION                            │
├──────────────────────────────────────────────────────────────────┤
│  Network Traffic → Suricata → eve.json → EdgeAISecure Parser     │
│                                                                   │
│  Flow Event:                                                      │
│  ├── src_ip: 192.168.50.80                                        │
│  ├── dest_ip: 142.250.185.46                                      │
│  ├── dest_port: 443                                               │
│  ├── protocol: TCP / app_proto: tls                               │
│  ├── bytes_toserver: 1024                                         │
│  └── timestamp: 2026-01-22T21:00:00Z                              │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                        FEATURE EXTRACTION                         │
├──────────────────────────────────────────────────────────────────┤
│  flowToFeatures(): {                                              │
│    bytes: 1024,                                                   │
│    protocol: 4,  // tls = 4                                       │
│    destPort: 443,                                                 │
│    hour: 21,                                                      │
│    dayOfWeek: 4  // Thursday                                      │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘
                              │
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
┌────────────────────┐ ┌────────────────┐ ┌────────────────────┐
│  STATISTICAL (40%) │ │ IFOREST (30%)  │ │   LSTM (30%)       │
├────────────────────┤ ├────────────────┤ ├────────────────────┤
│ • Z-Score          │ │ • Path length  │ │ • Sequence encode  │
│ • Protocol check   │ │ • 100 trees    │ │ • Reconstruction   │
│ • Destination      │ │ • Score 0-1    │ │ • Error score      │
│ • Time pattern     │ │                │ │                    │
└─────────┬──────────┘ └───────┬────────┘ └─────────┬──────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      ENSEMBLE SCORING                             │
├──────────────────────────────────────────────────────────────────┤
│  finalScore = (0.4 × statistical) + (0.3 × iforest) + (0.3 × lstm)│
│                                                                   │
│  if (finalScore > 0.5) → ANOMALY ALERT                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Low confidence | Insufficient training data | Extend learning duration |
| Too many false positives | Threshold too sensitive | Increase anomaly threshold |
| Missing protocols | Short learning period | Include more diverse traffic during learning |
| Model not trained | Learning interrupted | Reset and restart learning |

---

## Files Reference

| File | Purpose |
|------|---------|
| `server/ai-anomaly-detector.ts` | Statistical model + ensemble |
| `server/ml/isolation-forest.ts` | Isolation Forest implementation |
| `server/ml/lstm-autoencoder.ts` | LSTM sequence model |
| `server/baseline-service.ts` | Learning mode controller |
| `models/device_*_model.json` | Exported model files |
