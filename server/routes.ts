import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { loginSchema, insertDeviceGroupSchema, flowEvents } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { scanNetwork, getNetworkInterfaces, generateDeviceName, discoverDeviceDetails, getMacVendor, classifyDeviceType, scanPorts } from "./network-scanner";
import { updateDeviceAccess, getAccessControlStatus, saveAccessControlRules } from "./device-access-control";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Seed initial data on startup
  await storage.seedInitialData();

  // ==================== AUTH ROUTES ====================
  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
    }

    const { email, password } = parsed.data;

    // Demo credentials check (in production, verify against hashed password)
    const validCredentials =
      (email === "admin@iot.local" && password === "admin123") ||
      (email === "tkvfiles@gmail.com" && password === "1234");

    if (validCredentials) {
      const user = await storage.getUserByEmail(email);

      await storage.createLog({
        timestamp: new Date(),
        eventType: "login",
        performedBy: user?.name || "admin",
        details: `${user?.name || email} logged in successfully`,
      });

      res.json({
        success: true,
        user: user ? { id: user.id, email: user.email, name: user.name } : { id: 1, email, name: "Admin User" }
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    await storage.createLog({
      timestamp: new Date(),
      eventType: "logout",
      performedBy: "admin",
      details: "Admin logged out",
    });
    res.json({ success: true });
  });

  // ==================== DASHBOARD ROUTES ====================
  app.get("/api/dashboard/stats", async (req, res) => {
    const stats = await storage.getDashboardStats();
    res.json(stats);
  });

  // ==================== NOTIFICATION ROUTES ====================
  app.get("/api/notifications", async (req, res) => {
    const { notificationService } = await import("./notification-service");
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({
      notifications: notificationService.getNotifications(limit),
      unreadCount: notificationService.getUnreadCount(),
    });
  });

  app.get("/api/notifications/settings", async (req, res) => {
    const { notificationService } = await import("./notification-service");
    res.json(notificationService.getSettings());
  });

  app.post("/api/notifications/settings", async (req, res) => {
    const { notificationService } = await import("./notification-service");
    const settings = notificationService.updateSettings(req.body);
    res.json(settings);
  });

  app.post("/api/notifications/:id/read", async (req, res) => {
    const { notificationService } = await import("./notification-service");
    notificationService.markAsRead(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/read-all", async (req, res) => {
    const { notificationService } = await import("./notification-service");
    notificationService.markAllAsRead();
    res.json({ success: true });
  });

  app.delete("/api/notifications", async (req, res) => {
    const { notificationService } = await import("./notification-service");
    notificationService.clearAll();
    res.json({ success: true });
  });

  // ==================== NETWORK ROUTES ====================
  app.get("/api/network/interfaces", async (req, res) => {
    try {
      const interfaces = await getNetworkInterfaces();
      res.json(interfaces);
    } catch (error) {
      console.error("Error getting network interfaces:", error);
      res.status(500).json({ error: "Failed to get network interfaces" });
    }
  });

  // Traffic monitoring
  app.get("/api/network/stats", async (req, res) => {
    const { trafficMonitor } = await import("./traffic-monitor");
    const summary = await trafficMonitor.getNetworkSummary();
    res.json(summary);
  });

  app.get("/api/network/devices-traffic", async (req, res) => {
    const { trafficMonitor } = await import("./traffic-monitor");
    const traffic = await trafficMonitor.getDeviceTraffic();
    res.json(traffic);
  });

  // Traffic monitoring settings
  app.get("/api/traffic-monitor/settings", async (req, res) => {
    const { trafficMonitor } = await import("./traffic-monitor");
    res.json(trafficMonitor.getSettings());
  });

  app.post("/api/traffic-monitor/settings", async (req, res) => {
    const { trafficMonitor } = await import("./traffic-monitor");
    const settings = trafficMonitor.updateSettings(req.body);
    res.json(settings);
  });

  // Suricata IDS integration
  app.get("/api/suricata/status", async (req, res) => {
    const { suricataService } = await import("./suricata-service");
    res.json(suricataService.getStatus());
  });

  app.get("/api/suricata/stats", async (req, res) => {
    const { suricataService } = await import("./suricata-service");
    res.json(suricataService.getStats());
  });

  app.get("/api/suricata/alerts", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const { suricataService } = await import("./suricata-service");
    res.json(suricataService.getAlerts(limit));
  });

  app.post("/api/suricata/start", async (req, res) => {
    const { suricataService } = await import("./suricata-service");
    const started = suricataService.start();
    res.json({ success: started });
  });

  app.post("/api/suricata/stop", async (req, res) => {
    const { suricataService } = await import("./suricata-service");
    suricataService.stop();
    res.json({ success: true });
  });

  // Suricata device traffic (24/7 monitoring)
  app.get("/api/suricata/traffic", async (req, res) => {
    const { suricataService } = await import("./suricata-service");
    res.json(suricataService.getAllDeviceTraffic());
  });

  app.get("/api/suricata/traffic/:ip", async (req, res) => {
    const { suricataService } = await import("./suricata-service");
    const traffic = suricataService.getDeviceTraffic(req.params.ip);
    if (traffic) {
      res.json(traffic);
    } else {
      res.status(404).json({ error: "No traffic data for this IP" });
    }
  });

  // Historical flow data (from database - persisted for 3 days)
  app.get("/api/flows", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const flows = await storage.getFlowEvents(limit);
    res.json(flows);
  });

  app.get("/api/flows/:ip", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const flows = await storage.getFlowEventsByIp(req.params.ip, limit);
    res.json(flows);
  });

  // ==================== ACCESS CONTROL ====================
  app.get("/api/access-control/status", async (req, res) => {
    const status = await getAccessControlStatus();
    res.json(status);
  });

  app.post("/api/access-control/save", async (req, res) => {
    const success = await saveAccessControlRules();
    res.json({ success });
  });

  // ==================== AI MODEL ENDPOINTS ====================
  app.get("/api/ai/model/:deviceId", async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    if (isNaN(deviceId)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const { getModelSummary } = await import("./ai-anomaly-detector");
    const summary = getModelSummary(deviceId);
    res.json(summary);
  });

  app.get("/api/ai/learning-status", async (_req, res) => {
    const { getAllLearningStatus } = await import("./baseline-service");
    const status = getAllLearningStatus();
    res.json(status);
  });

  app.get("/api/ai/models", async (_req, res) => {
    const { getAllModelIds, getModelSummary } = await import("./ai-anomaly-detector");
    const modelIds = getAllModelIds();
    const models = modelIds.map(id => ({
      deviceId: id,
      ...getModelSummary(id),
    }));
    res.json(models);
  });
  app.post("/api/monitoring/start/:deviceId", async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    const device = await storage.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    const { packetCaptureService } = await import("./packet-capture");
    const started = await packetCaptureService.startCapture(device.ipAddress, undefined, deviceId);
    res.json({ success: started, device: device.ipAddress, deviceId });
  });

  app.post("/api/monitoring/stop", async (req, res) => {
    const { packetCaptureService } = await import("./packet-capture");
    packetCaptureService.stopCapture();
    res.json({ success: true });
  });

  app.get("/api/monitoring/status", async (req, res) => {
    const { packetCaptureService } = await import("./packet-capture");
    res.json(packetCaptureService.getStatus());
  });

  app.get("/api/monitoring/:deviceId/metrics", async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    const device = await storage.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    const { packetCaptureService } = await import("./packet-capture");
    const metrics = packetCaptureService.getDeviceMetrics(device.ipAddress);
    res.json({
      ...metrics,
      deviceId,
      deviceName: device.name,
      macAddress: device.macAddress,
      lastSeen: device.lastSeen,
    });
  });

  app.get("/api/monitoring/:deviceId/packets", async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    const device = await storage.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const { packetCaptureService } = await import("./packet-capture");
    const packets = packetCaptureService.getRecentPackets(device.ipAddress, limit);
    res.json(packets);
  });

  // Network-wide blocking settings
  app.get("/api/network-block/settings", async (req, res) => {
    const { networkBlockService } = await import("./network-block");
    res.json(networkBlockService.getSettings());
  });

  app.post("/api/network-block/settings", async (req, res) => {
    const { networkBlockService } = await import("./network-block");
    const settings = networkBlockService.updateSettings(req.body);
    res.json(settings);
  });

  app.get("/api/network-block/status", async (req, res) => {
    const { networkBlockService } = await import("./network-block");
    const deps = await networkBlockService.checkDependencies();
    const blocked = networkBlockService.getBlockedDevices();
    res.json({ ...deps, blockedDevices: blocked });
  });

  // Test OpenWRT connection
  app.post("/api/network-block/test-openwrt", async (req, res) => {
    const { testOpenwrtConnection } = await import("./network-block");
    const result = await testOpenwrtConnection();
    res.json(result);
  });

  // Train AI models from historical flow events
  app.post("/api/ai/train-from-history", async (req, res) => {
    try {
      const { trainFromHistoricalFlows, getBehaviorModel, getModelSummary } = await import("./ai-anomaly-detector");
      const devices = await storage.getDevices();

      let trainedCount = 0;
      const results: any[] = [];

      for (const device of devices) {
        if (device.status === "approved" || device.status === "monitoring") {
          try {
            // Get flow events for this device from database
            const flows = await db.select()
              .from(flowEvents)
              .where(eq(flowEvents.srcIp, device.ipAddress))
              .limit(1000);

            if (flows.length > 0) {
              // Train the model with historical flows
              for (const flow of flows) {
                trainFromHistoricalFlows(device.id, {
                  bytes: flow.totalBytes || 0,
                  protocol: flow.protocol || "unknown",
                  destIp: flow.destIp || "",
                  destPort: 0, // No destPort in flow_events table
                  timestamp: flow.timestamp || new Date(),
                });
              }

              const summary = getModelSummary(device.id);
              results.push({
                deviceId: device.id,
                name: device.name,
                flowsProcessed: flows.length,
                hasModel: summary.hasModel,
                confidence: summary.confidence,
                samples: summary.samples,
              });

              if (summary.hasModel) trainedCount++;
            }
          } catch (err) {
            console.log(`[AI] Failed to train for ${device.name}:`, err);
          }
        }
      }

      res.json({
        success: true,
        message: `Trained ${trainedCount} device models from historical data`,
        results,
      });
    } catch (error) {
      console.error("[AI] Train from history failed:", error);
      res.status(500).json({ error: "Failed to train from history" });
    }
  });

  // Retrain AI model for a device
  app.post("/api/devices/:id/retrain", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Start baseline learning with shorter duration for retraining
    const baselineService = await import("./baseline-service");
    const durationMs = 60 * 1000; // 1 minute for retraining

    await baselineService.startBaselineLearning(device, durationMs);

    res.json({
      success: true,
      message: `Retraining started for ${device.name}. Duration: ${durationMs / 1000}s`,
      deviceId: device.id,
    });
  });

  // Block device (DHCP-level, no IP)
  app.post("/api/devices/:id/block", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    const reason = req.body.reason || "Manual block by admin";

    const { networkBlockService } = await import("./network-block");
    const blocked = await networkBlockService.blockDevice(
      device.id,
      device.ipAddress,
      device.macAddress,
      reason,
      "blocked"  // Full DHCP-level blocking
    );

    if (blocked) {
      await storage.createLog({
        timestamp: new Date(),
        eventType: "device_blocked",
        performedBy: "admin",
        deviceId: device.id,
        deviceName: device.name,
        details: `Device BLOCKED (DHCP-level): ${device.name} - ${reason}`,
      });
    }

    res.json({ success: blocked, level: "blocked", method: networkBlockService.getSettings().method });
  });

  // Quarantine device (traffic-level filtering)
  app.post("/api/devices/:id/quarantine", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    const reason = req.body.reason || "Manual quarantine by admin";

    const { networkBlockService } = await import("./network-block");
    const quarantined = await networkBlockService.blockDevice(
      device.id,
      device.ipAddress,
      device.macAddress,
      reason,
      "quarantined"  // Traffic-level filtering only
    );

    if (quarantined) {
      await storage.createLog({
        timestamp: new Date(),
        eventType: "device_quarantined",
        performedBy: "admin",
        deviceId: device.id,
        deviceName: device.name,
        details: `Device QUARANTINED (traffic-level): ${device.name} - ${reason}`,
      });
    }

    res.json({ success: quarantined, level: "quarantined", method: networkBlockService.getSettings().method });
  });

  app.post("/api/devices/:id/unblock", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    const { networkBlockService } = await import("./network-block");
    const unblocked = await networkBlockService.unblockDevice(device.ipAddress);

    if (unblocked) {
      await storage.createLog({
        timestamp: new Date(),
        eventType: "device_unblocked",
        performedBy: "admin",
        deviceId: device.id,
        deviceName: device.name,
        details: `Device unblocked: ${device.name}`,
      });
    }

    res.json({ success: unblocked });
  });

  // Background scanner status endpoint
  app.get("/api/scanner/status", async (req, res) => {
    const { getScannerStatus } = await import("./background-scanner");
    res.json(getScannerStatus());
  });

  // Start/stop background scanner
  app.post("/api/scanner/start", async (req, res) => {
    const schema = z.object({
      intervalMinutes: z.number().min(1).max(60).optional().default(5),
    });
    const parsed = schema.safeParse(req.body);
    const interval = parsed.success ? parsed.data.intervalMinutes : 5;

    const { startBackgroundScanner, getScannerStatus } = await import("./background-scanner");
    startBackgroundScanner(interval);
    res.json(getScannerStatus());
  });

  app.post("/api/scanner/stop", async (req, res) => {
    const { stopBackgroundScanner, getScannerStatus } = await import("./background-scanner");
    stopBackgroundScanner();
    res.json(getScannerStatus());
  });

  app.post("/api/scanner/interval", async (req, res) => {
    const schema = z.object({
      intervalMinutes: z.number().min(1).max(60),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid interval" });
    }

    const { setScanInterval, getScannerStatus } = await import("./background-scanner");
    setScanInterval(parsed.data.intervalMinutes);
    res.json(getScannerStatus());
  });

  // ==================== DEVICE ROUTES ====================
  app.get("/api/devices", async (req, res) => {
    const devices = await storage.getDevices();

    // Enrich devices with AI confidence and learning progress data
    const aiModule = await import("./ai-anomaly-detector");
    const baselineModule = await import("./baseline-service");

    const enrichedDevices = devices.map(device => {
      try {
        const aiSummary = aiModule.getModelSummary(device.id);
        const inMemoryLearning = baselineModule.isDeviceLearning(device.id);
        // Device is learning if in-memory tracking OR status is monitoring/learning
        const isLearning = inMemoryLearning || device.status === "monitoring" || device.status === "learning";
        const learningProgress = inMemoryLearning
          ? Math.round(baselineModule.getLearningProgress(device.id) * 100)
          : (device.status === "monitoring" || device.status === "learning" ? 50 : 0); // Default 50% if in monitoring status

        // Calculate online status based on lastSeen (online if seen within 5 minutes)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const isOnline = device.lastSeen ? new Date(device.lastSeen) > fiveMinutesAgo : false;

        return {
          ...device,
          aiConfidence: aiSummary.confidence || 0,
          aiSamples: aiSummary.samples || 0,
          hasAiModel: aiSummary.hasModel || false,
          isLearning,
          learningProgress,
          isOnline,
        };
      } catch {
        const isLearning = device.status === "monitoring" || device.status === "learning";
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const isOnline = device.lastSeen ? new Date(device.lastSeen) > fiveMinutesAgo : false;
        return { ...device, aiConfidence: 0, aiSamples: 0, hasAiModel: false, isLearning, learningProgress: isLearning ? 50 : 0, isOnline };
      }
    });

    res.json(enrichedDevices);
  });

  // Get flow statistics for historical analysis
  app.get("/api/flows/stats", async (req, res) => {
    try {
      // Get total count
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(flowEvents);
      const totalFlows = countResult[0]?.count || 0;

      // Get time range
      const timeResult = await db.select({
        oldest: sql<Date>`min(timestamp)`,
        newest: sql<Date>`max(timestamp)`,
      }).from(flowEvents);

      res.json({
        totalFlows,
        oldestFlow: timeResult[0]?.oldest?.toISOString() || null,
        newestFlow: timeResult[0]?.newest?.toISOString() || null,
      });
    } catch (error) {
      console.error("[API] Failed to get flow stats:", error);
      res.status(500).json({ error: "Failed to get flow statistics" });
    }
  });

  // Get Suricata IDS alerts from fast.log
  app.get("/api/suricata/alerts", async (req, res) => {
    try {
      const { execSync } = await import("child_process");
      const logPath = "/var/log/suricata/fast.log";

      let content = "";
      try {
        content = execSync(`tail -100 ${logPath}`, { encoding: "utf-8" });
      } catch {
        return res.json([]);
      }

      const lines = content.trim().split("\n").filter(Boolean);
      const alerts: any[] = [];

      // Parse Suricata fast.log format:
      // 01/18/2026-11:11:26.411573  [**] [1:2033078:4] ET INFO ... [**] [Classification: ...] [Priority: 3] {UDP} 192.168.31.217:48817 -> 111.92.44.229:11520
      const alertRegex = /^(\S+)\s+\[\*\*\]\s+\[(\d+:\d+:\d+)\]\s+(.+?)\s+\[\*\*\]\s+\[Classification:\s*([^\]]*)\]\s+\[Priority:\s*(\d+)\]\s+\{(\w+)\}\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s*->\s*(\d+\.\d+\.\d+\.\d+):(\d+)/;

      for (const line of lines.slice(-100)) { // Last 100 alerts
        const match = line.match(alertRegex);
        if (match) {
          alerts.push({
            timestamp: match[1],
            sid: match[2],
            signature: match[3],
            classification: match[4],
            priority: parseInt(match[5]),
            protocol: match[6],
            srcIp: match[7],
            srcPort: parseInt(match[8]),
            destIp: match[9],
            destPort: parseInt(match[10]),
          });
        }
      }

      // Return newest first
      res.json(alerts.reverse());
    } catch (error) {
      console.error("[API] Failed to get Suricata alerts:", error);
      res.status(500).json({ error: "Failed to get Suricata alerts" });
    }
  });

  app.get("/api/devices/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json(device);
  });

  // Get device type/port info for a specific device
  app.get("/api/devices/:id/detect", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    try {
      // Scan ports
      const { openPorts, services } = await scanPorts(device.ipAddress);
      const macVendor = getMacVendor(device.macAddress);
      const deviceType = classifyDeviceType(macVendor, openPorts, services);

      res.json({
        deviceId: device.id,
        name: device.name,
        ipAddress: device.ipAddress,
        macAddress: device.macAddress,
        vendor: macVendor || "Unknown",
        openPorts,
        services,
        deviceType,
        isIoT: ["IoT Sensor", "Camera", "Smart Device"].includes(deviceType),
      });
    } catch (error) {
      console.error("Error detecting device type:", error);
      res.status(500).json({ error: "Failed to detect device type" });
    }
  });

  // Rename device endpoint
  app.put("/api/devices/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const schema = z.object({
      name: z.string().min(1).max(100),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
    }

    const device = await storage.updateDeviceName(id, parsed.data.name);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await storage.createLog({
      timestamp: new Date(),
      eventType: "settings_changed",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Device renamed to "${device.name}"`,
    });

    res.json(device);
  });

  // Network scan endpoint - discover real devices on the network
  app.post("/api/devices/scan", async (req, res) => {
    try {
      const schema = z.object({
        interface: z.string().optional(),
        deep: z.boolean().optional().default(false),
      });

      const parsed = schema.safeParse(req.body);
      const iface = parsed.success ? parsed.data.interface : undefined;
      const deep = parsed.success ? parsed.data.deep : false;

      console.log(`Starting network scan (interface: ${iface || "all"}, deep: ${deep})`);

      const discoveredDevices = await scanNetwork(iface, deep);
      const newDevices: any[] = [];

      for (const discovered of discoveredDevices) {
        // Check if device already exists by MAC address
        const existingDevice = await storage.getDeviceByMac(discovered.macAddress);

        if (!existingDevice) {
          // Generate a friendly name from hostname or MAC vendor
          const deviceName = await generateDeviceName(discovered.macAddress, discovered.ipAddress);

          // Create new device
          const newDevice = await storage.createDevice({
            name: deviceName,
            macAddress: discovered.macAddress.toUpperCase(),
            ipAddress: discovered.ipAddress,
            status: "new",
            firstSeen: new Date(),
            lastSeen: new Date(),
            trafficRate: 0,
            avgTrafficRate: 0,
            protocols: {},
          });

          newDevices.push(newDevice);

          // Log device discovery
          await storage.createLog({
            timestamp: new Date(),
            eventType: "device_discovered",
            performedBy: "system",
            deviceId: newDevice.id,
            deviceName: newDevice.name,
            details: `Real device discovered on network: ${newDevice.name} (${discovered.ipAddress}, ${discovered.macAddress})`,
          });

          // Send notification
          const { notificationService } = await import("./notification-service");
          await notificationService.notifyNewDevice(
            newDevice.name,
            discovered.ipAddress,
            discovered.macAddress,
            newDevice.id
          );
        } else {
          // Update last seen and IP address if changed (DHCP may assign new IP)
          if (existingDevice.ipAddress !== discovered.ipAddress) {
            await storage.updateDeviceIp(existingDevice.id, discovered.ipAddress);
            console.log(`[Scan] Updated IP for ${existingDevice.name}: ${existingDevice.ipAddress} -> ${discovered.ipAddress}`);
          } else {
            await storage.updateDeviceMetrics(existingDevice.id, existingDevice.trafficRate);
          }
        }
      }

      res.json({
        scanned: discoveredDevices.length,
        newDevices: newDevices.length,
        devices: newDevices,
      });
    } catch (error) {
      console.error("Error scanning network:", error);
      res.status(500).json({ error: "Failed to scan network" });
    }
  });

  app.post("/api/devices/simulate", async (req, res) => {
    const device = await storage.simulateNewDevice();

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_discovered",
      performedBy: "system",
      deviceId: device.id,
      deviceName: device.name,
      details: `New device ${device.name} discovered on network`,
    });

    res.json(device);
  });

  app.post("/api/devices/:id/approve", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.startBaselineLearning(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_approved",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Device ${device.name} was approved and baseline learning started`,
    });

    // Update access control to allow this device
    await updateDeviceAccess(device.macAddress, "approved");

    res.json(device);
  });

  app.post("/api/devices/:id/reject", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.updateDeviceStatus(id, "blocked");
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_rejected",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Device ${device.name} was rejected and blocked from the network`,
    });

    // Update access control to block this device
    await updateDeviceAccess(device.macAddress, "blocked");

    res.json(device);
  });

  app.post("/api/devices/:id/block", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.updateDeviceStatus(id, "blocked");
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_blocked",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Device ${device.name} was manually blocked from the network`,
    });

    // Update access control to block this device
    await updateDeviceAccess(device.macAddress, "blocked");

    res.json(device);
  });

  app.post("/api/devices/:id/unblock", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.startBaselineLearning(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_approved",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Device ${device.name} was unblocked and re-approved`,
    });

    // Update access control to allow this device
    await updateDeviceAccess(device.macAddress, "approved");

    res.json(device);
  });

  app.delete("/api/devices/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Create log before deletion (device info is needed)
    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_rejected",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Device ${device.name} was removed from the network`,
    });

    // Remove from access control (block the MAC)
    await updateDeviceAccess(device.macAddress, "blocked");

    const deleted = await storage.deleteDevice(id);
    if (!deleted) {
      return res.status(500).json({ error: "Failed to delete device" });
    }

    res.json({ success: true });
  });

  app.post("/api/devices/:id/simulate-attack", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const device = await storage.getDevice(id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Create a high-severity alert for the device (simulates attack traffic)
    const alert = await storage.createAlert({
      deviceId: device.id,
      deviceName: device.name,
      timestamp: new Date(),
      anomalyType: "port_scan",
      severity: "high",
      status: "open",
      anomalyScore: 0.92,
      description: `Simulated attack traffic detected: Port scanning and unusual protocol patterns from ${device.name}`,
    });

    await storage.createLog({
      timestamp: new Date(),
      eventType: "anomaly_detected",
      performedBy: "admin",
      deviceId: device.id,
      deviceName: device.name,
      details: `Simulated attack traffic generated for testing: ${alert.description}`,
    });

    // Auto-quarantine for the simulated attack
    await storage.updateDeviceStatus(device.id, "quarantined");
    await storage.createQuarantineRecord({
      deviceId: device.id,
      deviceName: device.name,
      reason: "Quarantined due to simulated attack traffic",
      timeQuarantined: new Date(),
      alertId: alert.id,
    });

    res.json(alert);
  });

  app.post("/api/devices/:id/group", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }

    const schema = z.object({ groupId: z.number().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const device = await storage.updateDeviceGroup(id, parsed.data.groupId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json(device);
  });

  app.get("/api/devices/:id/packets", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid device ID" });
    }
    const packets = await storage.getPacketEvents(id);
    res.json(packets);
  });

  // ==================== DEVICE GROUPS ROUTES ====================
  app.get("/api/device-groups", async (req, res) => {
    const groups = await storage.getDeviceGroups();
    res.json(groups);
  });

  app.post("/api/device-groups", async (req, res) => {
    const parsed = insertDeviceGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
    }

    const group = await storage.createDeviceGroup(parsed.data);
    res.json(group);
  });

  app.delete("/api/device-groups/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid group ID" });
    }
    await storage.deleteDeviceGroup(id);
    res.json({ success: true });
  });

  // ==================== TRAFFIC ROUTES ====================
  app.get("/api/traffic", async (req, res) => {
    const trafficData = await storage.getTrafficData();
    res.json(trafficData);
  });

  // ==================== ALERT ROUTES ====================
  app.get("/api/alerts", async (req, res) => {
    const alerts = await storage.getAlerts();
    res.json(alerts);
  });

  app.get("/api/alerts/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid alert ID" });
    }
    const alert = await storage.getAlert(id);
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    res.json(alert);
  });

  app.post("/api/alerts/simulate", async (req, res) => {
    const alert = await storage.simulateAlert();
    if (!alert) {
      return res.status(400).json({ error: "No devices available for alert simulation" });
    }

    await storage.createLog({
      timestamp: new Date(),
      eventType: "anomaly_detected",
      performedBy: "system",
      deviceId: alert.deviceId,
      deviceName: alert.deviceName,
      details: alert.description,
    });

    // Auto-quarantine for high severity alerts
    if (alert.severity === "high") {
      const device = await storage.getDevice(alert.deviceId);
      if (device && device.status !== "quarantined") {
        await storage.updateDeviceStatus(alert.deviceId, "quarantined");

        await storage.createQuarantineRecord({
          deviceId: alert.deviceId,
          deviceName: alert.deviceName,
          reason: alert.description,
          timeQuarantined: new Date(),
          alertId: alert.id,
        });

        await storage.createLog({
          timestamp: new Date(),
          eventType: "device_quarantined",
          performedBy: "system",
          deviceId: alert.deviceId,
          deviceName: alert.deviceName,
          details: `Device ${alert.deviceName} automatically quarantined due to high severity anomaly`,
        });
      }
    }

    res.json(alert);
  });

  app.post("/api/alerts/:id/acknowledge", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid alert ID" });
    }
    const alert = await storage.updateAlertStatus(id, "acknowledged");
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    res.json(alert);
  });

  app.post("/api/alerts/:id/resolve", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid alert ID" });
    }
    const alert = await storage.updateAlertStatus(id, "resolved");
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    res.json(alert);
  });

  // ==================== QUARANTINE ROUTES ====================
  app.get("/api/quarantine", async (req, res) => {
    const records = await storage.getQuarantineRecords();
    res.json(records);
  });

  app.post("/api/quarantine/:id/release", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid quarantine record ID" });
    }
    const record = await storage.getQuarantineRecord(id);
    if (!record) {
      return res.status(404).json({ error: "Quarantine record not found" });
    }

    await storage.updateDeviceStatus(record.deviceId, "approved");
    await storage.deleteQuarantineRecord(id);

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_released",
      performedBy: "admin",
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      details: `Device ${record.deviceName} released from quarantine`,
    });

    res.json({ success: true });
  });

  app.post("/api/quarantine/:id/block", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid quarantine record ID" });
    }
    const record = await storage.getQuarantineRecord(id);
    if (!record) {
      return res.status(404).json({ error: "Quarantine record not found" });
    }

    await storage.updateDeviceStatus(record.deviceId, "blocked");
    await storage.deleteQuarantineRecord(id);

    await storage.createLog({
      timestamp: new Date(),
      eventType: "device_blocked",
      performedBy: "admin",
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      details: `Device ${record.deviceName} permanently blocked from network`,
    });

    res.json({ success: true });
  });

  // ==================== LOG ROUTES ====================
  app.get("/api/logs", async (req, res) => {
    const logs = await storage.getLogs();
    res.json(logs);
  });

  // ==================== SETTINGS ROUTES ====================
  app.get("/api/settings", async (_req, res) => {
    const userSettings = await storage.getSettings(1); // Default user
    res.json(
      userSettings || {
        anomalySensitivity: "medium",
        alertRefreshInterval: 30,
        theme: "light",
        learningDurationSeconds: 60,
      },
    );
  });

  app.put("/api/settings", async (req, res) => {
    const schema = z.object({
      anomalySensitivity: z.enum(["low", "medium", "high"]).optional(),
      alertRefreshInterval: z.number().optional(),
      theme: z.enum(["light", "dark"]).optional(),
      learningDurationSeconds: z.number().min(10).max(86400).optional(), // 10 seconds to 1 day
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const updated = await storage.updateSettings(1, parsed.data);

    await storage.createLog({
      timestamp: new Date(),
      eventType: "settings_changed",
      performedBy: "admin",
      details: `Settings updated: ${JSON.stringify(parsed.data)}`,
    });

    res.json(updated);
  });

  return httpServer;
}
