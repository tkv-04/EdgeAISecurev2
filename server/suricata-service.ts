import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { storage } from "./storage";
import { notificationService } from "./notification-service";
import { isDeviceLearning, addFlowToLearning, checkFlowForAnomaly, createAnomalyAlert } from "./baseline-service";
import { analyzeConnection, getProtocolName, isSuspiciousPort } from "./protocol-detector";

// ==================== Types ====================

export interface SuricataAlert {
    timestamp: Date;
    eventType: string;
    srcIp: string;
    srcPort?: number;
    destIp: string;
    destPort?: number;
    protocol: string;
    alert?: {
        action: string;
        gid: number;
        signatureId: number;
        rev: number;
        signature: string;
        category: string;
        severity: number;
    };
    flow?: {
        pktsToserver: number;
        pktsToClient: number;
        bytesToServer: number;
        bytesToClient: number;
        state: string;
    };
    appProto?: string;
}

export interface SuricataStats {
    uptime: number;
    packetsTotal: number;
    alertsTotal: number;
    flowsTotal: number;
}

export interface DeviceTraffic {
    ipAddress: string;
    bytesIn: number;
    bytesOut: number;
    flowCount: number;
    protocolDistribution: Record<string, number>;
    recentFlows: Array<{
        timestamp: Date;
        protocol: string;
        destIp: string;
        bytes: number;
    }>;
    lastUpdated: Date;
}

// ==================== Service ====================

class SuricataReaderService extends EventEmitter {
    private tailProcess: ChildProcess | null = null;
    private isRunning = false;
    private evePath = "/var/log/suricata/eve.json";

    // Alert storage (circular buffer)
    private alertHistory: SuricataAlert[] = [];
    private maxAlerts = 500;

    // Per-device traffic tracking (24/7)
    private deviceTraffic = new Map<string, DeviceTraffic>();
    private maxFlowsPerDevice = 30;

    // Stats
    private stats: SuricataStats = {
        uptime: 0,
        packetsTotal: 0,
        alertsTotal: 0,
        flowsTotal: 0,
    };

    constructor() {
        super();
    }

    /**
     * Start tailing the EVE JSON log
     */
    start(): boolean {
        if (this.isRunning) {
            console.log("[Suricata] Reader already running");
            return true;
        }

        try {
            // Use tail -F to follow the log file
            this.tailProcess = spawn("sudo", ["tail", "-F", "-n", "100", this.evePath], {
                stdio: ["pipe", "pipe", "pipe"]
            });

            this.isRunning = true;

            this.tailProcess.stdout?.on("data", (data: Buffer) => {
                const lines = data.toString().split("\n").filter(Boolean);
                for (const line of lines) {
                    this.processLine(line);
                }
            });

            this.tailProcess.stderr?.on("data", (data: Buffer) => {
                const msg = data.toString();
                if (!msg.includes("file truncated")) {
                    console.error("[Suricata] tail error:", msg);
                }
            });

            this.tailProcess.on("close", (code) => {
                console.log("[Suricata] tail exited with code", code);
                this.isRunning = false;
            });

            console.log("[Suricata] Started reading EVE log");
            return true;
        } catch (error) {
            console.error("[Suricata] Start failed:", error);
            return false;
        }
    }

    /**
     * Stop reading
     */
    stop(): void {
        if (this.tailProcess) {
            this.tailProcess.kill();
            this.tailProcess = null;
            this.isRunning = false;
            console.log("[Suricata] Stopped");
        }
    }

    /**
     * Process a line from EVE JSON
     */
    private async processLine(line: string): Promise<void> {
        try {
            const event = JSON.parse(line);

            switch (event.event_type) {
                case "alert":
                    await this.processAlert(event);
                    break;
                case "stats":
                    this.processStats(event);
                    break;
                case "flow":
                    this.processFlow(event);
                    break;
                // Add more event types as needed (http, dns, tls, etc.)
            }
        } catch {
            // Ignore parse errors
        }
    }

    /**
     * Process an alert event
     */
    private async processAlert(event: any): Promise<void> {
        const alert: SuricataAlert = {
            timestamp: new Date(event.timestamp),
            eventType: "alert",
            srcIp: event.src_ip,
            srcPort: event.src_port,
            destIp: event.dest_ip,
            destPort: event.dest_port,
            protocol: event.proto,
            alert: event.alert ? {
                action: event.alert.action,
                gid: event.alert.gid,
                signatureId: event.alert.signature_id,
                rev: event.alert.rev,
                signature: event.alert.signature,
                category: event.alert.category,
                severity: event.alert.severity,
            } : undefined,
            appProto: event.app_proto,
        };

        // Store in history (in-memory)
        this.alertHistory.push(alert);
        if (this.alertHistory.length > this.maxAlerts) {
            this.alertHistory.shift();
        }

        this.stats.alertsTotal++;

        // Persist to database for historical analysis
        if (alert.alert) {
            storage.addSuricataAlert({
                timestamp: alert.timestamp,
                eventType: alert.eventType,
                srcIp: alert.srcIp,
                srcPort: alert.srcPort,
                destIp: alert.destIp,
                destPort: alert.destPort,
                protocol: alert.protocol,
                appProto: alert.appProto,
                signatureId: alert.alert.signatureId,
                signature: alert.alert.signature,
                category: alert.alert.category,
                severity: alert.alert.severity,
                action: alert.alert.action,
            }).catch(err => {
                console.error('[Suricata] Failed to persist alert:', err);
            });
        }

        // Emit event
        this.emit("alert", alert);

        // Create app alert if severity is high
        if (alert.alert && alert.alert.severity <= 2) {
            // Find device by IP
            const devices = await storage.getDevices();
            const device = devices.find((d) =>
                d.ipAddress === alert.srcIp || d.ipAddress === alert.destIp
            );

            if (device) {
                // Create alert in our system
                await storage.createAlert({
                    deviceId: device.id,
                    deviceName: device.name,
                    timestamp: alert.timestamp,
                    anomalyType: "suricata_ids",
                    severity: alert.alert.severity === 1 ? "critical" : "high",
                    status: "open",
                    anomalyScore: (4 - alert.alert.severity) * 25, // 1=75, 2=50
                    description: `[${alert.alert.category}] ${alert.alert.signature}`,
                });

                // Notify
                await notificationService.notifySuspiciousActivity(
                    device.name,
                    alert.alert.signature,
                    device.id
                );

                console.log(`[Suricata] ALERT: ${alert.alert.signature} (${device.name})`);
            }
        }
    }

    /**
     * Process stats event
     */
    private processStats(event: any): void {
        if (event.stats) {
            this.stats.uptime = event.stats.uptime || 0;
            this.stats.packetsTotal = event.stats.capture?.kernel_packets || 0;
            this.stats.flowsTotal = event.stats.flow?.total || 0;
        }
    }

    /**
     * Process flow event - track per-device traffic
     */
    private processFlow(event: any): void {
        // Use 'proto' field for transport layer (TCP, UDP, ICMP)
        // Use 'app_proto' for application layer (http, dns, tls) as enhancement
        const transportProto = event.proto || "unknown";  // TCP, UDP, ICMP, etc.
        const appProto = event.app_proto;  // http, dns, tls, quic, etc.
        const destPort = event.dest_port || 0;

        // Determine the best protocol name to display
        let protocol: string;
        if (appProto && appProto !== "failed") {
            // Suricata detected the app protocol - use it
            protocol = appProto.toLowerCase();
        } else {
            // Suricata didn't detect app protocol - use port-based detection
            // getProtocolName returns "HTTPS" for 443, "HTTP" for 80, "TCP/1234" for unknown
            protocol = getProtocolName(destPort, transportProto).toLowerCase();
        }

        if (protocol === "failed") return;

        const srcIp = event.src_ip;
        const destIp = event.dest_ip;
        // destPort already declared above for protocol detection
        const bytesToServer = event.flow?.bytes_toserver || 0;
        const bytesToClient = event.flow?.bytes_toclient || 0;
        const timestamp = new Date(event.timestamp);

        // Helper to update device traffic
        const updateDevice = (ip: string, isSource: boolean) => {
            if (!this.deviceTraffic.has(ip)) {
                this.deviceTraffic.set(ip, {
                    ipAddress: ip,
                    bytesIn: 0,
                    bytesOut: 0,
                    flowCount: 0,
                    protocolDistribution: {},
                    recentFlows: [],
                    lastUpdated: timestamp,
                });
            }

            const traffic = this.deviceTraffic.get(ip)!;
            traffic.bytesOut += isSource ? bytesToServer : bytesToClient;
            traffic.bytesIn += isSource ? bytesToClient : bytesToServer;
            traffic.flowCount++;
            traffic.protocolDistribution[protocol] = (traffic.protocolDistribution[protocol] || 0) + 1;
            traffic.lastUpdated = timestamp;

            // Add to recent flows
            traffic.recentFlows.push({
                timestamp,
                protocol,
                destIp: isSource ? destIp : srcIp,
                bytes: bytesToServer + bytesToClient,
            });

            // Keep only recent flows
            if (traffic.recentFlows.length > this.maxFlowsPerDevice) {
                traffic.recentFlows.shift();
            }
        };

        updateDevice(srcIp, true);
        updateDevice(destIp, false);

        // Persist flow to database (async, don't block)
        const totalBytes = bytesToServer + bytesToClient;
        storage.addFlowEvent({
            timestamp,
            srcIp,
            destIp,
            protocol,
            bytesToServer,
            bytesToClient,
            totalBytes,
        }).catch(() => {
            // Silently ignore errors to avoid spam
        });

        // Baseline learning integration
        // Check if source device is learning and add flow data
        this.processFlowForBaseline(srcIp, {
            protocol,
            destIp,
            destPort,
            bytes: totalBytes,
            timestamp,
        });

        // Emit event
        this.emit("flow", { srcIp, destIp, protocol, bytesToServer, bytesToClient });
    }

    /**
     * Process a flow for baseline learning and anomaly detection
     */
    private async processFlowForBaseline(deviceIp: string, flow: {
        protocol: string;
        destIp: string;
        destPort: number;
        bytes: number;
        timestamp: Date;
    }): Promise<void> {
        try {
            // Find device by IP
            const device = await storage.getDeviceByIp(deviceIp);
            if (!device) return;

            // If device is in learning mode, add flow to learning data
            if (isDeviceLearning(device.id)) {
                addFlowToLearning(device.id, flow);

                // Still check for suspicious ports even during learning
                const portCheck = isSuspiciousPort(flow.destPort);
                if (portCheck.suspicious && portCheck.severity === "high") {
                    await storage.createAlert({
                        deviceId: device.id,
                        deviceName: device.name,
                        timestamp: flow.timestamp,
                        anomalyType: "suspicious_port",
                        severity: "high",
                        status: "open",
                        anomalyScore: 85,
                        description: `⚠️ Suspicious port detected: ${flow.destPort} - ${portCheck.reason}`,
                    });
                    console.log(`[Suricata] SUSPICIOUS PORT ALERT: ${device.name} connected to port ${flow.destPort} - ${portCheck.reason}`);
                }
                return;
            }

            // If device is approved, check for anomalies
            if (device.status === "approved") {
                // FIRST: Check for suspicious ports immediately (bypasses rate limiting)
                const portCheck = isSuspiciousPort(flow.destPort);
                if (portCheck.suspicious) {
                    const portScore = portCheck.severity === "high" ? 0.95 : 0.75;
                    const alertKey = `${device.id}:suspicious_port:${flow.destPort}`;
                    const lastPortAlert = this.lastAnomalyAlerts.get(alertKey);
                    const nowPort = Date.now();

                    // Rate limit per suspicious port (1 per 2 minutes per port)
                    if (!lastPortAlert || (nowPort - lastPortAlert) > 2 * 60 * 1000) {
                        this.lastAnomalyAlerts.set(alertKey, nowPort);
                        await storage.createAlert({
                            deviceId: device.id,
                            deviceName: device.name,
                            timestamp: flow.timestamp,
                            anomalyType: "suspicious_port",
                            severity: portCheck.severity === "high" ? "critical" : "high",
                            status: "open",
                            anomalyScore: portScore,
                            description: `🚨 SUSPICIOUS PORT: ${flow.destPort} - ${portCheck.reason}`,
                        });
                        console.log(`[Suricata] SUSPICIOUS PORT: ${device.name} -> port ${flow.destPort} (${portCheck.reason})`);

                        // AUTO-QUARANTINE: Trigger for high-severity suspicious ports
                        if (portCheck.severity === "high") {
                            try {
                                const { evaluateForQuarantine } = await import("./auto-quarantine");
                                await evaluateForQuarantine(device, portScore, `Suspicious port ${flow.destPort}: ${portCheck.reason}`);
                            } catch (err) {
                                console.error(`[Suricata] Auto-quarantine error:`, err);
                            }
                        }
                    }
                }

                // THEN: Regular anomaly detection
                const result = await checkFlowForAnomaly(device.id, flow);
                const { isAnomaly, reasons } = result;
                const anomalyScore = (result as any).anomalyScore || 0.5;

                if (isAnomaly) {
                    // Check for auto-quarantine (critical anomalies)
                    try {
                        const { evaluateForQuarantine } = await import("./auto-quarantine");
                        await evaluateForQuarantine(device, anomalyScore, reasons.join("; "));
                    } catch (err) {
                        // Auto-quarantine not critical, continue
                    }

                    // Rate limit alerts (max 1 per device per 5 minutes)
                    const alertKey = `${device.id}:${flow.destIp}`;
                    const lastAlert = this.lastAnomalyAlerts.get(alertKey);
                    const now = Date.now();

                    if (!lastAlert || (now - lastAlert) > 5 * 60 * 1000) {
                        this.lastAnomalyAlerts.set(alertKey, now);

                        await createAnomalyAlert(
                            device,
                            "behavior_anomaly",
                            reasons.join("; "),
                            anomalyScore
                        );
                    }
                }
            }
        } catch {
            // Silently ignore errors
        }
    }

    // Track last anomaly alert time per device/destination to rate limit
    private lastAnomalyAlerts = new Map<string, number>();

    /**
     * Get traffic data for a specific device (by IP)
     */
    getDeviceTraffic(ipAddress: string): DeviceTraffic | null {
        return this.deviceTraffic.get(ipAddress) || null;
    }

    /**
     * Get all device traffic (for monitoring page)
     */
    getAllDeviceTraffic(): DeviceTraffic[] {
        return Array.from(this.deviceTraffic.values());
    }

    /**
     * Get recent alerts
     */
    getAlerts(limit = 50): SuricataAlert[] {
        return this.alertHistory.slice(-limit).reverse();
    }

    /**
     * Get stats
     */
    getStats(): SuricataStats {
        return { ...this.stats };
    }

    /**
     * Get status
     */
    getStatus(): { running: boolean; evePath: string } {
        return {
            running: this.isRunning,
            evePath: this.evePath,
        };
    }
}

// Singleton instance
export const suricataService = new SuricataReaderService();

// Auto-start if Suricata is running
import { exec } from "child_process";
exec("systemctl is-active suricata", (error, stdout) => {
    if (stdout.trim() === "active") {
        console.log("[Suricata] Service is active, starting EVE reader...");
        suricataService.start();
    }
});

// Cleanup old flows every hour (keep 3 days)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DAYS_TO_KEEP = 3;

setInterval(async () => {
    try {
        const deleted = await storage.cleanupOldFlowEvents(DAYS_TO_KEEP);
        if (deleted > 0) {
            console.log(`[Suricata] Cleaned up ${deleted} flow events older than ${DAYS_TO_KEEP} days`);
        }
    } catch (error) {
        // Silently ignore cleanup errors
    }
}, CLEANUP_INTERVAL_MS);

// Traffic tracking for dashboard graph
// Collect bytes and flow counts per device every 30 seconds
const TRAFFIC_INTERVAL_MS = 30 * 1000; // 30 seconds
const devicePrevBytes = new Map<string, number>(); // Track previous total bytes
const devicePrevFlows = new Map<string, number>(); // Track previous flow counts

setInterval(async () => {
    try {
        const allDevices = await storage.getDevices();
        const allTraffic = suricataService.getAllDeviceTraffic();

        for (const traffic of allTraffic) {
            // Find device by IP
            const device = allDevices.find(d => d.ipAddress === traffic.ipAddress);
            if (!device) continue;

            // Calculate bytes since last check
            const totalBytes = traffic.bytesIn + traffic.bytesOut;
            const prevBytes = devicePrevBytes.get(traffic.ipAddress) || 0;
            const bytesSinceLastCheck = totalBytes - prevBytes;
            devicePrevBytes.set(traffic.ipAddress, totalBytes);

            // Calculate flows since last check
            const prevFlows = devicePrevFlows.get(traffic.ipAddress) || 0;
            const flowsSinceLastCheck = traffic.flowCount - prevFlows;
            devicePrevFlows.set(traffic.ipAddress, traffic.flowCount);

            // Always record (even if 0) to keep continuous data
            const intervalSeconds = TRAFFIC_INTERVAL_MS / 1000;
            const bps = Math.round(bytesSinceLastCheck / intervalSeconds);
            const fps = Math.round(flowsSinceLastCheck / intervalSeconds);

            // Save to trafficData table
            await storage.addTrafficData({
                deviceId: device.id,
                packetsPerSecond: fps,
                bytesPerSecond: bps,
            });

            // Also update device's trafficRate field for display on pages
            await storage.updateDeviceMetrics(device.id, bps);
        }
    } catch (error) {
        // Silently ignore collection errors
    }
}, TRAFFIC_INTERVAL_MS);
