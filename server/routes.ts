import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { loginSchema, insertDeviceGroupSchema } from "@shared/schema";
import { z } from "zod";

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

  // ==================== DEVICE ROUTES ====================
  app.get("/api/devices", async (req, res) => {
    const devices = await storage.getDevices();
    res.json(devices);
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
