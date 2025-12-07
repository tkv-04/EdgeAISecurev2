import { db } from "./db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import {
  devices,
  deviceGroups,
  alerts,
  quarantineRecords,
  logs,
  trafficData,
  packetEvents,
  users,
  settings,
  type Device,
  type DeviceGroup,
  type Alert,
  type QuarantineRecord,
  type LogEntry,
  type TrafficDataPoint,
  type PacketEvent,
  type User,
  type Settings,
  type InsertDevice,
  type InsertDeviceGroup,
  type InsertAlert,
  type InsertQuarantineRecord,
  type InsertLogEntry,
  type InsertTrafficData,
  type InsertPacketEvent,
  type InsertUser,
  type InsertSettings,
  type DeviceStatus,
  type DashboardStats,
  type AnomalyType,
  type AlertSeverity,
} from "@shared/schema";

export interface IStorage {
  // Devices
  getDevices(): Promise<Device[]>;
  getDevice(id: number): Promise<Device | undefined>;
  createDevice(device: InsertDevice): Promise<Device>;
  updateDeviceStatus(id: number, status: DeviceStatus): Promise<Device | undefined>;
  updateDeviceMetrics(id: number, trafficRate: number): Promise<Device | undefined>;
  updateDeviceGroup(id: number, groupId: number | null): Promise<Device | undefined>;
  deleteDevice(id: number): Promise<boolean>;
  startBaselineLearning(deviceId: number): Promise<Device | undefined>;

  // Device Groups
  getDeviceGroups(): Promise<DeviceGroup[]>;
  getDeviceGroup(id: number): Promise<DeviceGroup | undefined>;
  createDeviceGroup(group: InsertDeviceGroup): Promise<DeviceGroup>;
  updateDeviceGroupDetails(id: number, group: Partial<InsertDeviceGroup>): Promise<DeviceGroup | undefined>;
  deleteDeviceGroup(id: number): Promise<boolean>;

  // Alerts
  getAlerts(): Promise<Alert[]>;
  getAlert(id: number): Promise<Alert | undefined>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  updateAlertStatus(id: number, status: "open" | "acknowledged" | "resolved"): Promise<Alert | undefined>;

  // Quarantine
  getQuarantineRecords(): Promise<QuarantineRecord[]>;
  getQuarantineRecord(id: number): Promise<QuarantineRecord | undefined>;
  createQuarantineRecord(record: InsertQuarantineRecord): Promise<QuarantineRecord>;
  deleteQuarantineRecord(id: number): Promise<boolean>;

  // Logs
  getLogs(): Promise<LogEntry[]>;
  createLog(log: InsertLogEntry): Promise<LogEntry>;

  // Traffic & Packets
  getTrafficData(): Promise<TrafficDataPoint[]>;
  getPacketEvents(deviceId: number): Promise<PacketEvent[]>;
  addTrafficData(data: InsertTrafficData): Promise<TrafficDataPoint>;
  addPacketEvent(event: InsertPacketEvent): Promise<PacketEvent>;

  // Users
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Settings
  getSettings(userId: number): Promise<Settings | undefined>;
  updateSettings(userId: number, updates: Partial<InsertSettings>): Promise<Settings | undefined>;

  // Stats
  getDashboardStats(): Promise<DashboardStats>;

  // Simulation helpers
  simulateNewDevice(): Promise<Device>;
  simulateAlert(): Promise<Alert | null>;

  // Seed data
  seedInitialData(): Promise<void>;
}

const PROTOCOLS = ["HTTP", "HTTPS", "MQTT", "CoAP", "WebSocket", "TCP", "UDP", "DNS"];
const DEFAULT_BASELINE_LEARNING_DURATION_MS = 60 * 1000; // 1 minute simulated learning window

function generateMacAddress(): string {
  const hex = "0123456789ABCDEF";
  let mac = "";
  for (let i = 0; i < 6; i++) {
    mac += hex[Math.floor(Math.random() * 16)];
    mac += hex[Math.floor(Math.random() * 16)];
    if (i < 5) mac += ":";
  }
  return mac;
}

function generateIpAddress(): string {
  return `192.168.1.${Math.floor(Math.random() * 200) + 50}`;
}

function generateProtocolDistribution(): Record<string, number> {
  const protocols: Record<string, number> = {};
  let remaining = 100;
  const selectedProtocols = PROTOCOLS.slice(0, Math.floor(Math.random() * 4) + 2);
  
  selectedProtocols.forEach((protocol, index) => {
    if (index === selectedProtocols.length - 1) {
      protocols[protocol] = remaining;
    } else {
      const value = Math.floor(Math.random() * (remaining / 2)) + 10;
      protocols[protocol] = value;
      remaining -= value;
    }
  });
  
  return protocols;
}

function getAlertDescription(type: AnomalyType, deviceName: string): string {
  const descriptions: Record<AnomalyType, string> = {
    high_traffic: `Abnormally high network traffic detected from ${deviceName}`,
    unknown_ip: `${deviceName} attempted connection to unknown external IP address`,
    port_scan: `Port scanning behavior detected from ${deviceName}`,
    protocol_violation: `${deviceName} using unexpected network protocol`,
    unusual_timing: `${deviceName} active during unusual hours`,
    data_exfiltration: `Potential data exfiltration detected from ${deviceName}`,
  };
  return descriptions[type];
}

export class DatabaseStorage implements IStorage {
  private baselineLearningTimers = new Map<number, NodeJS.Timeout>();
  // Device methods
  async getDevices(): Promise<Device[]> {
    return db.select().from(devices).orderBy(desc(devices.lastSeen));
  }

  async getDevice(id: number): Promise<Device | undefined> {
    const [device] = await db.select().from(devices).where(eq(devices.id, id));
    return device;
  }

  async createDevice(device: InsertDevice): Promise<Device> {
    const [newDevice] = await db.insert(devices).values(device).returning();
    return newDevice;
  }

  async updateDeviceStatus(id: number, status: DeviceStatus): Promise<Device | undefined> {
    const [device] = await db
      .update(devices)
      .set({ status, lastSeen: new Date() })
      .where(eq(devices.id, id))
      .returning();
    return device;
  }

  async updateDeviceMetrics(id: number, trafficRate: number): Promise<Device | undefined> {
    const [device] = await db
      .update(devices)
      .set({ trafficRate, lastSeen: new Date() })
      .where(eq(devices.id, id))
      .returning();
    return device;
  }

  async updateDeviceGroup(id: number, groupId: number | null): Promise<Device | undefined> {
    const [device] = await db
      .update(devices)
      .set({ groupId })
      .where(eq(devices.id, id))
      .returning();
    return device;
  }

  async deleteDevice(id: number): Promise<boolean> {
    try {
      // Verify device exists before attempting deletion
      const device = await this.getDevice(id);
      if (!device) {
        return false;
      }

      // Delete related records first to avoid foreign key constraint issues
      await db.delete(alerts).where(eq(alerts.deviceId, id));
      await db.delete(quarantineRecords).where(eq(quarantineRecords.deviceId, id));
      await db.delete(trafficData).where(eq(trafficData.deviceId, id));
      await db.delete(packetEvents).where(eq(packetEvents.deviceId, id));
      await db.delete(logs).where(eq(logs.deviceId, id));
      
      // Now delete the device
      await db.delete(devices).where(eq(devices.id, id));
      
      // Verify deletion was successful
      const deletedDevice = await this.getDevice(id);
      return deletedDevice === undefined;
    } catch (error) {
      console.error("Error deleting device:", error);
      return false;
    }
  }

  async startBaselineLearning(deviceId: number): Promise<Device | undefined> {
    const device = await this.getDevice(deviceId);
    if (!device) {
      return undefined;
    }

    const baselineAvg =
      device.avgTrafficRate > 0 ? device.avgTrafficRate : device.trafficRate;

    const [monitoringDevice] = await db
      .update(devices)
      .set({
        status: "monitoring",
        avgTrafficRate: baselineAvg,
        lastSeen: new Date(),
      })
      .where(eq(devices.id, deviceId))
      .returning();

    if (!monitoringDevice) {
      return undefined;
    }

    // Look up user-specific baseline learning duration from settings (default to 60s)
    const userSettings = await this.getSettings(1);
    const durationMs =
      (userSettings?.learningDurationSeconds ?? 60) * 1000;

    this.scheduleBaselineCompletion(monitoringDevice, durationMs);
    return monitoringDevice;
  }

  // Device Groups
  async getDeviceGroups(): Promise<DeviceGroup[]> {
    return db.select().from(deviceGroups).orderBy(deviceGroups.name);
  }

  async getDeviceGroup(id: number): Promise<DeviceGroup | undefined> {
    const [group] = await db.select().from(deviceGroups).where(eq(deviceGroups.id, id));
    return group;
  }

  async createDeviceGroup(group: InsertDeviceGroup): Promise<DeviceGroup> {
    const [newGroup] = await db.insert(deviceGroups).values(group).returning();
    return newGroup;
  }

  async updateDeviceGroupDetails(id: number, group: Partial<InsertDeviceGroup>): Promise<DeviceGroup | undefined> {
    const [updatedGroup] = await db
      .update(deviceGroups)
      .set(group)
      .where(eq(deviceGroups.id, id))
      .returning();
    return updatedGroup;
  }

  async deleteDeviceGroup(id: number): Promise<boolean> {
    await db.update(devices).set({ groupId: null }).where(eq(devices.groupId, id));
    await db.delete(deviceGroups).where(eq(deviceGroups.id, id));
    return true;
  }

  // Alert methods
  async getAlerts(): Promise<Alert[]> {
    return db.select().from(alerts).orderBy(desc(alerts.timestamp));
  }

  async getAlert(id: number): Promise<Alert | undefined> {
    const [alert] = await db.select().from(alerts).where(eq(alerts.id, id));
    return alert;
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [newAlert] = await db.insert(alerts).values(alert).returning();
    return newAlert;
  }

  async updateAlertStatus(id: number, status: "open" | "acknowledged" | "resolved"): Promise<Alert | undefined> {
    const [alert] = await db
      .update(alerts)
      .set({ status })
      .where(eq(alerts.id, id))
      .returning();
    return alert;
  }

  // Quarantine methods
  async getQuarantineRecords(): Promise<QuarantineRecord[]> {
    return db.select().from(quarantineRecords).orderBy(desc(quarantineRecords.timeQuarantined));
  }

  async getQuarantineRecord(id: number): Promise<QuarantineRecord | undefined> {
    const [record] = await db.select().from(quarantineRecords).where(eq(quarantineRecords.id, id));
    return record;
  }

  async createQuarantineRecord(record: InsertQuarantineRecord): Promise<QuarantineRecord> {
    const [newRecord] = await db.insert(quarantineRecords).values(record).returning();
    return newRecord;
  }

  async deleteQuarantineRecord(id: number): Promise<boolean> {
    await db.delete(quarantineRecords).where(eq(quarantineRecords.id, id));
    return true;
  }

  // Log methods
  async getLogs(): Promise<LogEntry[]> {
    return db.select().from(logs).orderBy(desc(logs.timestamp)).limit(500);
  }

  async createLog(log: InsertLogEntry): Promise<LogEntry> {
    const [newLog] = await db.insert(logs).values(log).returning();
    return newLog;
  }

  // Traffic & Packet methods
  async getTrafficData(): Promise<TrafficDataPoint[]> {
    return db.select().from(trafficData).orderBy(desc(trafficData.timestamp)).limit(100);
  }

  async getPacketEvents(deviceId: number): Promise<PacketEvent[]> {
    return db
      .select()
      .from(packetEvents)
      .where(eq(packetEvents.deviceId, deviceId))
      .orderBy(desc(packetEvents.timestamp))
      .limit(50);
  }

  async addTrafficData(data: InsertTrafficData): Promise<TrafficDataPoint> {
    const [newData] = await db.insert(trafficData).values(data).returning();
    return newData;
  }

  async addPacketEvent(event: InsertPacketEvent): Promise<PacketEvent> {
    const [newEvent] = await db.insert(packetEvents).values(event).returning();
    return newEvent;
  }

  // User methods
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // Settings methods
  async getSettings(userId: number): Promise<Settings | undefined> {
    const [userSettings] = await db.select().from(settings).where(eq(settings.userId, userId));
    return userSettings;
  }

  async updateSettings(userId: number, updates: Partial<InsertSettings>): Promise<Settings | undefined> {
    const existing = await this.getSettings(userId);
    if (existing) {
      const [updated] = await db
        .update(settings)
        .set(updates)
        .where(eq(settings.userId, userId))
        .returning();
      return updated;
    } else {
      const [newSettings] = await db
        .insert(settings)
        .values({ userId, ...updates })
        .returning();
      return newSettings;
    }
  }

  // Stats
  async getDashboardStats(): Promise<DashboardStats> {
    const allDevices = await this.getDevices();
    const allAlerts = await this.getAlerts();
    
    return {
      totalDevices: allDevices.length,
      pendingApprovals: allDevices.filter((d) => d.status === "new").length,
      activeAlerts: allAlerts.filter((a) => a.status === "open").length,
      quarantinedDevices: allDevices.filter((d) => d.status === "quarantined").length,
    };
  }

  private scheduleBaselineCompletion(device: Device, durationMs: number = DEFAULT_BASELINE_LEARNING_DURATION_MS) {
    const existingTimer = this.baselineLearningTimers.get(device.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        const baselineAvg =
          device.avgTrafficRate > 0 ? device.avgTrafficRate : device.trafficRate;

        const [completed] = await db
          .update(devices)
          .set({
            status: "approved",
            avgTrafficRate: baselineAvg,
            lastSeen: new Date(),
          })
          .where(and(eq(devices.id, device.id), eq(devices.status, "monitoring")))
          .returning();

        if (completed) {
          await this.createLog({
            timestamp: new Date(),
            eventType: "device_approved",
            performedBy: "system",
            deviceId: completed.id,
            deviceName: completed.name,
            details: `Baseline learning completed for ${completed.name}`,
          });
        }
      } catch (error) {
        console.error("Failed to complete baseline learning", error);
      } finally {
        this.baselineLearningTimers.delete(device.id);
      }
    }, durationMs);

    this.baselineLearningTimers.set(device.id, timer);
  }

  // Simulation helpers
  async simulateNewDevice(): Promise<Device> {
    const allDevices = await this.getDevices();
    const index = allDevices.length + 1;
    const deviceTypes = ["Camera", "Sensor", "SmartPlug", "Thermostat", "Gateway", "Speaker"];
    const type = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];

    // New devices should start in identification (status "new").
    // Baseline learning will only start after explicit approval via the API.
    const newDevice = await this.createDevice({
      name: `${type}-${String(index).padStart(2, "0")}`,
      macAddress: generateMacAddress(),
      ipAddress: generateIpAddress(),
      status: "new",
      firstSeen: new Date(),
      lastSeen: new Date(),
      trafficRate: Math.floor(Math.random() * 100) + 20,
      avgTrafficRate: 0,
      protocols: generateProtocolDistribution(),
    });

    // Do NOT automatically start baseline learning here.
    // The `/api/devices/:id/approve` route will call `startBaselineLearning`
    // when the user approves the device.
    return newDevice;
  }

  async simulateAlert(): Promise<Alert | null> {
    const allDevices = await this.getDevices();
    const eligibleDevices = allDevices.filter((d) => d.status === "approved" || d.status === "monitoring");
    
    if (eligibleDevices.length === 0) return null;
    
    const device = eligibleDevices[Math.floor(Math.random() * eligibleDevices.length)];
    const anomalyTypes: AnomalyType[] = ["high_traffic", "unknown_ip", "port_scan", "protocol_violation", "unusual_timing", "data_exfiltration"];
    const severities: AlertSeverity[] = ["low", "medium", "high"];
    
    const anomalyType = anomalyTypes[Math.floor(Math.random() * anomalyTypes.length)];
    const severity = severities[Math.floor(Math.random() * severities.length)];
    const score = severity === "high" ? 0.8 + Math.random() * 0.2 : severity === "medium" ? 0.5 + Math.random() * 0.3 : 0.2 + Math.random() * 0.3;
    
    return this.createAlert({
      deviceId: device.id,
      deviceName: device.name,
      timestamp: new Date(),
      anomalyType,
      severity,
      status: "open",
      anomalyScore: Math.round(score * 100) / 100,
      description: getAlertDescription(anomalyType, device.name),
    });
  }

  // Seed initial data
  async seedInitialData(): Promise<void> {
    // Check if data already exists
    const existingDevices = await this.getDevices();
    if (existingDevices.length > 0) return;

    const now = new Date();

    // Create default admin user with hashed password (password: admin123)
    const existingUser = await this.getUserByEmail("admin@iot.local");
    let userId = 1;
    if (!existingUser) {
      const user = await this.createUser({
        email: "admin@iot.local",
        name: "Admin User",
        passwordHash: "$2b$10$demo_hash_admin123", // In production, use bcrypt
      });
      userId = user.id;
    } else {
      userId = existingUser.id;
    }

    // Create additional admin user (email: tkvfiles@gmail.com, password: 1234)
    const existingAdmin2 = await this.getUserByEmail("tkvfiles@gmail.com");
    let admin2UserId: number | null = null;
    if (!existingAdmin2) {
      const admin2User = await this.createUser({
        email: "tkvfiles@gmail.com",
        name: "Admin User 2",
        passwordHash: "$2b$10$demo_hash_1234", // In production, use bcrypt
      });
      admin2UserId = admin2User.id;
    } else {
      admin2UserId = existingAdmin2.id;
    }

    // Create default settings for admin2 if user was just created
    if (admin2UserId) {
      const existingAdmin2Settings = await this.getSettings(admin2UserId);
      if (!existingAdmin2Settings) {
        await this.updateSettings(admin2UserId, {
          anomalySensitivity: "medium",
          alertRefreshInterval: 30,
          theme: "light",
          learningDurationSeconds: 60,
        });
      }
    }

    // Create default settings
    await this.updateSettings(userId, {
      anomalySensitivity: "medium",
      alertRefreshInterval: 30,
      theme: "light",
      learningDurationSeconds: 60,
    });

    // Create device groups
    const groups = await Promise.all([
      this.createDeviceGroup({ name: "Cameras", description: "Security cameras", color: "#3b82f6" }),
      this.createDeviceGroup({ name: "Sensors", description: "Environmental sensors", color: "#22c55e" }),
      this.createDeviceGroup({ name: "Smart Home", description: "Smart home devices", color: "#f59e0b" }),
    ]);

    // Create initial devices
    const initialDevices = [
      {
        name: "Camera-01",
        macAddress: "AA:BB:CC:11:22:33",
        ipAddress: "192.168.1.101",
        status: "approved" as const,
        firstSeen: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        lastSeen: new Date(now.getTime() - 30000),
        trafficRate: 145,
        avgTrafficRate: 120,
        protocols: { HTTP: 40, MQTT: 35, TCP: 25 },
        groupId: groups[0].id,
      },
      {
        name: "Sensor-01",
        macAddress: "AA:BB:CC:44:55:66",
        ipAddress: "192.168.1.102",
        status: "approved" as const,
        firstSeen: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        lastSeen: new Date(now.getTime() - 60000),
        trafficRate: 45,
        avgTrafficRate: 50,
        protocols: { MQTT: 60, CoAP: 30, UDP: 10 },
        groupId: groups[1].id,
      },
      {
        name: "DoorLock-01",
        macAddress: "AA:BB:CC:77:88:99",
        ipAddress: "192.168.1.103",
        status: "monitoring" as const,
        firstSeen: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        lastSeen: new Date(now.getTime() - 120000),
        trafficRate: 25,
        avgTrafficRate: 20,
        protocols: { HTTPS: 70, TCP: 30 },
        groupId: groups[2].id,
      },
      {
        name: "SmartBulb-01",
        macAddress: "AA:BB:CC:AA:BB:CC",
        ipAddress: "192.168.1.104",
        status: "approved" as const,
        firstSeen: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        lastSeen: new Date(now.getTime() - 45000),
        trafficRate: 12,
        avgTrafficRate: 15,
        protocols: { HTTP: 50, UDP: 30, DNS: 20 },
        groupId: groups[2].id,
      },
      {
        name: "Unknown-Device-X",
        macAddress: "DD:EE:FF:11:22:33",
        ipAddress: "192.168.1.199",
        status: "new" as const,
        firstSeen: new Date(now.getTime() - 30 * 60 * 1000),
        lastSeen: new Date(now.getTime() - 5000),
        trafficRate: 350,
        avgTrafficRate: 0,
        protocols: { TCP: 80, UDP: 20 },
        groupId: null,
      },
    ];

    const createdDevices = await Promise.all(
      initialDevices.map((device) => this.createDevice(device))
    );

    // Create initial alerts
    const anomalyTypes: AnomalyType[] = ["high_traffic", "unknown_ip", "port_scan", "protocol_violation"];
    const severities: AlertSeverity[] = ["low", "medium", "high"];
    const statuses = ["open", "acknowledged", "resolved"] as const;

    for (let i = 0; i < 5; i++) {
      const device = createdDevices[Math.floor(Math.random() * createdDevices.length)];
      const anomalyType = anomalyTypes[Math.floor(Math.random() * anomalyTypes.length)];
      const severity = severities[Math.floor(Math.random() * severities.length)];
      const status = i === 0 ? "open" : i < 3 ? "acknowledged" : "resolved";

      await this.createAlert({
        deviceId: device.id,
        deviceName: device.name,
        timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
        anomalyType,
        severity,
        status,
        anomalyScore: Math.random() * 0.5 + 0.4,
        description: getAlertDescription(anomalyType, device.name),
      });
    }

    // Create initial logs
    const logEvents = [
      { eventType: "login", performedBy: "admin", details: "Admin logged in successfully" },
      { eventType: "device_approved", performedBy: "admin", deviceName: "Camera-01", details: "Device Camera-01 was approved and baseline learning started" },
      { eventType: "device_discovered", performedBy: "system", deviceName: "Unknown-Device-X", details: "New device discovered on network" },
      { eventType: "anomaly_detected", performedBy: "system", deviceName: "DoorLock-01", details: "Unusual traffic pattern detected" },
    ];

    for (let i = 0; i < logEvents.length; i++) {
      const event = logEvents[i];
      await this.createLog({
        timestamp: new Date(now.getTime() - i * 30 * 60 * 1000),
        eventType: event.eventType,
        performedBy: event.performedBy,
        deviceName: event.deviceName,
        details: event.details,
      });
    }

    // Generate traffic data for charts
    const approvedDevices = createdDevices.filter((d) => d.status === "approved" || d.status === "monitoring");
    for (let i = 24; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000);
      for (const device of approvedDevices) {
        await this.addTrafficData({
          timestamp,
          deviceId: device.id,
          packetsPerSecond: Math.floor(device.avgTrafficRate * (0.7 + Math.random() * 0.6)),
        });
      }
    }

    // Generate packet events for monitoring
    for (const device of approvedDevices) {
      const protocols = Object.keys(device.protocols as Record<string, number>);
      for (let i = 0; i < 15; i++) {
        await this.addPacketEvent({
          timestamp: new Date(now.getTime() - i * 5000),
          deviceId: device.id,
          protocol: protocols[Math.floor(Math.random() * protocols.length)],
          sourceIp: Math.random() > 0.5 ? device.ipAddress : `10.0.0.${Math.floor(Math.random() * 255)}`,
          destIp: Math.random() > 0.5 ? `10.0.0.${Math.floor(Math.random() * 255)}` : device.ipAddress,
          size: Math.floor(Math.random() * 1500) + 64,
          direction: Math.random() > 0.5 ? "inbound" : "outbound",
        });
      }
    }

    console.log("Initial data seeded successfully");
  }
}

export const storage = new DatabaseStorage();
