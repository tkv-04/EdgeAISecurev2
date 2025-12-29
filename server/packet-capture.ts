import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { storage } from "./storage";

// ==================== Types ====================

export interface PacketEvent {
    timestamp: Date;
    protocol: string;
    sourceIP: string;
    sourcePort?: number;
    destIP: string;
    destPort?: number;
    size: number;
    direction: "inbound" | "outbound" | "unknown";
    raw?: string;
}

export interface DeviceMetrics {
    deviceIP: string;
    currentRate: number;      // packets per second
    baselineAverage: number;  // 24-hour rolling average
    protocolDistribution: Record<string, number>;
    totalPackets: number;
    totalBytes: number;
    lastUpdated: Date;
}

// ==================== State ====================

class PacketCaptureService extends EventEmitter {
    private tcpdumpProcess: ChildProcess | null = null;
    private isRunning = false;
    private interface = "wlan0";

    // Per-device packet storage (circular buffer)
    private packetHistory = new Map<string, PacketEvent[]>();
    private maxPacketsPerDevice = 100;

    // Metrics tracking
    private metricsCache = new Map<string, DeviceMetrics>();
    private packetCounts = new Map<string, { count: number; bytes: number; timestamp: Date }>();

    // Baseline tracking (hourly samples for 24h)
    private baselineHistory = new Map<string, number[]>();

    // Map device IP to device ID for database storage
    private deviceIdMap = new Map<string, number>();

    constructor() {
        super();
    }

    /**
     * Start packet capture for specific device IP
     */
    async startCapture(deviceIP: string, networkInterface?: string, deviceId?: number): Promise<boolean> {
        // Store device ID for database persistence
        if (deviceId) {
            this.deviceIdMap.set(deviceIP, deviceId);
        }

        if (this.isRunning) {
            console.log("[PacketCapture] Already running, adding filter for", deviceIP);
            return true;
        }

        this.interface = networkInterface || "wlan0";

        try {
            // tcpdump with output format for parsing
            // -l: line buffered, -n: no DNS resolution, -q: quiet (less output)
            // -tt: unix timestamp, -e: include MAC
            const filter = deviceIP ? `host ${deviceIP}` : "";

            this.tcpdumpProcess = spawn("sudo", [
                "tcpdump",
                "-i", this.interface,
                "-l",           // Line buffered
                "-n",           // No DNS
                "-q",           // Quiet
                "-tt",          // Unix timestamp
                filter
            ].filter(Boolean), {
                stdio: ["pipe", "pipe", "pipe"]
            });

            this.isRunning = true;

            this.tcpdumpProcess.stdout?.on("data", (data: Buffer) => {
                const lines = data.toString().split("\n").filter(Boolean);
                for (const line of lines) {
                    const packet = this.parseTcpdumpLine(line, deviceIP);
                    if (packet) {
                        this.processPacket(packet, deviceIP);
                    }
                }
            });

            this.tcpdumpProcess.stderr?.on("data", (data: Buffer) => {
                const msg = data.toString();
                if (!msg.includes("listening on")) {
                    console.error("[PacketCapture] tcpdump error:", msg);
                }
            });

            this.tcpdumpProcess.on("close", (code) => {
                console.log("[PacketCapture] tcpdump exited with code", code);
                this.isRunning = false;
            });

            console.log(`[PacketCapture] Started capture on ${this.interface} for ${deviceIP || "all"}`);
            return true;
        } catch (error) {
            console.error("[PacketCapture] Start failed:", error);
            return false;
        }
    }

    /**
     * Stop packet capture
     */
    stopCapture(): void {
        if (this.tcpdumpProcess) {
            this.tcpdumpProcess.kill();
            this.tcpdumpProcess = null;
            this.isRunning = false;
            console.log("[PacketCapture] Stopped");
        }
    }

    /**
     * Parse tcpdump output line
     */
    private parseTcpdumpLine(line: string, filterIP: string): PacketEvent | null {
        try {
            // Example formats:
            // 1703683200.123456 IP 192.168.1.101.443 > 10.0.0.1.53245: tcp 64
            // 1703683200.123456 IP 192.168.1.101 > 10.0.0.1: ICMP echo request

            const parts = line.trim().split(/\s+/);
            if (parts.length < 5) return null;

            const timestamp = new Date(parseFloat(parts[0]) * 1000);
            const protocolType = parts[1];

            if (protocolType !== "IP" && protocolType !== "IP6") return null;

            // Parse source and destination
            const sourceRaw = parts[2];
            const destRaw = parts[4]?.replace(":", "") || "";

            const { ip: sourceIP, port: sourcePort } = this.parseAddress(sourceRaw);
            const { ip: destIP, port: destPort } = this.parseAddress(destRaw);

            // Determine protocol from packet content
            let protocol = "TCP";
            const lineUpper = line.toUpperCase();

            if (lineUpper.includes("ICMP")) {
                protocol = "ICMP";
            } else if (lineUpper.includes("UDP") || destPort === 53 || sourcePort === 53) {
                protocol = "UDP";
            } else if (destPort === 80 || sourcePort === 80) {
                protocol = "HTTP";
            } else if (destPort === 443 || sourcePort === 443) {
                protocol = "HTTPS";
            } else if (destPort === 1883 || sourcePort === 1883) {
                protocol = "MQTT";
            } else if (destPort === 22 || sourcePort === 22) {
                protocol = "SSH";
            } else if (destPort === 5353 || sourcePort === 5353) {
                protocol = "mDNS";
            }

            // Extract packet size
            const sizeMatch = line.match(/length\s+(\d+)/i) || line.match(/(\d+)\s*$/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;

            // Determine direction relative to device
            let direction: "inbound" | "outbound" | "unknown" = "unknown";
            if (filterIP) {
                if (sourceIP === filterIP) {
                    direction = "outbound";
                } else if (destIP === filterIP) {
                    direction = "inbound";
                }
            }

            return {
                timestamp,
                protocol,
                sourceIP,
                sourcePort,
                destIP,
                destPort,
                size,
                direction,
                raw: line.substring(0, 200),
            };
        } catch {
            return null;
        }
    }

    /**
     * Parse IP:port address
     */
    private parseAddress(addr: string): { ip: string; port?: number } {
        if (!addr) return { ip: "" };

        const lastDot = addr.lastIndexOf(".");
        if (lastDot === -1) return { ip: addr };

        const potentialPort = addr.substring(lastDot + 1);
        if (/^\d+$/.test(potentialPort) && parseInt(potentialPort) > 255) {
            // It's a port number
            return {
                ip: addr.substring(0, lastDot),
                port: parseInt(potentialPort),
            };
        }

        return { ip: addr };
    }

    /**
     * Process and store packet (in-memory + database)
     */
    private async processPacket(packet: PacketEvent, deviceIP: string): Promise<void> {
        // Store in memory for real-time display
        if (!this.packetHistory.has(deviceIP)) {
            this.packetHistory.set(deviceIP, []);
        }

        const history = this.packetHistory.get(deviceIP)!;
        history.push(packet);

        // Keep only last N packets in memory
        if (history.length > this.maxPacketsPerDevice) {
            history.shift();
        }

        // Update counts for rate calculation
        const counts = this.packetCounts.get(deviceIP) || { count: 0, bytes: 0, timestamp: new Date() };
        counts.count++;
        counts.bytes += packet.size;
        this.packetCounts.set(deviceIP, counts);

        // Save to database (async, don't block)
        const deviceId = this.deviceIdMap.get(deviceIP);
        if (deviceId) {
            try {
                await storage.addPacketEvent({
                    timestamp: packet.timestamp,
                    deviceId,
                    protocol: packet.protocol,
                    sourceIp: packet.sourceIP,
                    destIp: packet.destIP,
                    size: packet.size,
                    direction: packet.direction,
                });
            } catch (error) {
                // Don't log every error to avoid spam
                // console.error("[PacketCapture] DB save error:", error);
            }
        }

        // Emit event
        this.emit("packet", packet, deviceIP);
    }

    /**
     * Get recent packets for a device
     */
    getRecentPackets(deviceIP: string, limit = 50): PacketEvent[] {
        const history = this.packetHistory.get(deviceIP) || [];
        return history.slice(-limit).reverse(); // Most recent first
    }

    /**
     * Get device metrics
     */
    getDeviceMetrics(deviceIP: string): DeviceMetrics {
        const history = this.packetHistory.get(deviceIP) || [];
        const now = new Date();

        // Calculate current rate (packets in last 10 seconds)
        const recentWindow = 10 * 1000; // 10 seconds
        const recentPackets = history.filter((p) =>
            now.getTime() - p.timestamp.getTime() < recentWindow
        );
        const currentRate = recentPackets.length / (recentWindow / 1000);

        // Protocol distribution
        const protocolDistribution: Record<string, number> = {};
        for (const packet of history) {
            protocolDistribution[packet.protocol] = (protocolDistribution[packet.protocol] || 0) + 1;
        }

        // Total bytes
        const totalBytes = history.reduce((sum, p) => sum + p.size, 0);

        // Get baseline (simplified - use average of recent measurements)
        const baseline = this.baselineHistory.get(deviceIP) || [];
        const baselineAverage = baseline.length > 0
            ? baseline.reduce((a, b) => a + b, 0) / baseline.length
            : currentRate;

        // Update baseline history (every minute, keep 60 samples = 1 hour)
        if (baseline.length === 0 || now.getTime() % 60000 < 1000) {
            baseline.push(currentRate);
            if (baseline.length > 60) baseline.shift();
            this.baselineHistory.set(deviceIP, baseline);
        }

        return {
            deviceIP,
            currentRate: parseFloat(currentRate.toFixed(1)),
            baselineAverage: parseFloat(baselineAverage.toFixed(1)),
            protocolDistribution,
            totalPackets: history.length,
            totalBytes,
            lastUpdated: now,
        };
    }

    /**
     * Get capture status
     */
    getStatus(): { running: boolean; interface: string; devices: string[] } {
        return {
            running: this.isRunning,
            interface: this.interface,
            devices: Array.from(this.packetHistory.keys()),
        };
    }

    /**
     * Clear data for a device
     */
    clearDeviceData(deviceIP: string): void {
        this.packetHistory.delete(deviceIP);
        this.metricsCache.delete(deviceIP);
        this.packetCounts.delete(deviceIP);
        this.baselineHistory.delete(deviceIP);
    }
}

// Singleton instance
export const packetCaptureService = new PacketCaptureService();
