import { pgTable, text, integer, real, timestamp, jsonb, varchar, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==================== DATABASE TABLES ====================

// Devices table
export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  macAddress: text("mac_address").notNull(),
  ipAddress: text("ip_address").notNull(),
  status: text("status").notNull().default("new"),
  firstSeen: timestamp("first_seen").notNull().defaultNow(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
  trafficRate: real("traffic_rate").notNull().default(0),
  avgTrafficRate: real("avg_traffic_rate").notNull().default(0),
  protocols: jsonb("protocols").notNull().default({}),
  groupId: integer("group_id"),
});

// Device Groups table
export const deviceGroups = pgTable("device_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").default("#6366f1"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Alerts table
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull(),
  deviceName: text("device_name").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  anomalyType: text("anomaly_type").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("open"),
  anomalyScore: real("anomaly_score").notNull(),
  description: text("description").notNull(),
});

// Quarantine records table
export const quarantineRecords = pgTable("quarantine_records", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull(),
  deviceName: text("device_name").notNull(),
  reason: text("reason").notNull(),
  timeQuarantined: timestamp("time_quarantined").notNull().defaultNow(),
  alertId: integer("alert_id"),
});

// Logs table
export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  eventType: text("event_type").notNull(),
  performedBy: text("performed_by").notNull(),
  deviceId: integer("device_id"),
  deviceName: text("device_name"),
  details: text("details").notNull(),
});

// Traffic data table
export const trafficData = pgTable("traffic_data", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  deviceId: integer("device_id").notNull(),
  packetsPerSecond: integer("packets_per_second").notNull(),
  bytesPerSecond: integer("bytes_per_second").notNull().default(0),
});

// Packet events table
export const packetEvents = pgTable("packet_events", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  deviceId: integer("device_id").notNull(),
  protocol: text("protocol").notNull(),
  sourceIp: text("source_ip").notNull(),
  destIp: text("dest_ip").notNull(),
  size: integer("size").notNull(),
  direction: text("direction").notNull(),
});

// Flow events table (Suricata flows - persisted for 3 days)
export const flowEvents = pgTable("flow_events", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  srcIp: text("src_ip").notNull(),
  destIp: text("dest_ip").notNull(),
  protocol: text("protocol").notNull(),
  bytesToServer: integer("bytes_to_server").notNull().default(0),
  bytesToClient: integer("bytes_to_client").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
});

// Device baselines table (learned behavior profiles)
export const deviceBaselines = pgTable("device_baselines", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull(),
  // Traffic metrics
  avgBytesPerSec: real("avg_bytes_per_sec").notNull().default(0),
  maxBytesPerSec: real("max_bytes_per_sec").notNull().default(0),
  avgConnectionsPerMin: real("avg_connections_per_min").notNull().default(0),
  // Learned patterns (JSON arrays)
  protocols: jsonb("protocols").notNull().default([]),           // ["TCP", "UDP", "HTTP"]
  destinations: jsonb("destinations").notNull().default([]),     // ["8.8.8.8", "api.example.com"]
  ports: jsonb("ports").notNull().default([]),                   // [80, 443, 1883]
  activeHours: jsonb("active_hours").notNull().default({}),      // {"9": 10, "10": 15, ...}
  // Learning metadata
  learningStartedAt: timestamp("learning_started_at").notNull().defaultNow(),
  learningCompletedAt: timestamp("learning_completed_at"),
  flowsAnalyzed: integer("flows_analyzed").notNull().default(0),
  isComplete: integer("is_complete").notNull().default(0),       // 0 = learning, 1 = complete
});

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Settings table
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  anomalySensitivity: text("anomaly_sensitivity").notNull().default("medium"),
  alertRefreshInterval: integer("alert_refresh_interval").notNull().default(30),
  theme: text("theme").notNull().default("light"),
  // Baseline learning duration in seconds (how long devices stay in learning phase)
  learningDurationSeconds: integer("learning_duration_seconds").notNull().default(60),
});

// ==================== ZOD SCHEMAS ====================

// Device Status Types
export const deviceStatusEnum = z.enum(["new", "approved", "monitoring", "quarantined", "blocked"]);
export type DeviceStatus = z.infer<typeof deviceStatusEnum>;

// Alert Severity Types
export const alertSeverityEnum = z.enum(["low", "medium", "high"]);
export type AlertSeverity = z.infer<typeof alertSeverityEnum>;

// Alert Status Types
export const alertStatusEnum = z.enum(["open", "acknowledged", "resolved"]);
export type AlertStatus = z.infer<typeof alertStatusEnum>;

// Anomaly Types
export const anomalyTypeEnum = z.enum([
  "high_traffic",
  "unknown_ip",
  "port_scan",
  "protocol_violation",
  "unusual_timing",
  "data_exfiltration"
]);
export type AnomalyType = z.infer<typeof anomalyTypeEnum>;

// Log Event Types
export const logEventTypeEnum = z.enum([
  "device_approved",
  "device_rejected",
  "device_discovered",
  "anomaly_detected",
  "device_quarantined",
  "device_released",
  "device_blocked",
  "login",
  "logout",
  "settings_changed"
]);
export type LogEventType = z.infer<typeof logEventTypeEnum>;

// ==================== INSERT SCHEMAS ====================

export const insertDeviceSchema = createInsertSchema(devices).omit({ id: true });
export type InsertDevice = z.infer<typeof insertDeviceSchema>;

export const insertDeviceGroupSchema = createInsertSchema(deviceGroups).omit({ id: true });
export type InsertDeviceGroup = z.infer<typeof insertDeviceGroupSchema>;

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export const insertQuarantineSchema = createInsertSchema(quarantineRecords).omit({ id: true });
export type InsertQuarantineRecord = z.infer<typeof insertQuarantineSchema>;

export const insertLogSchema = createInsertSchema(logs).omit({ id: true });
export type InsertLogEntry = z.infer<typeof insertLogSchema>;

export const insertTrafficDataSchema = createInsertSchema(trafficData).omit({ id: true });
export type InsertTrafficData = z.infer<typeof insertTrafficDataSchema>;

export const insertPacketEventSchema = createInsertSchema(packetEvents).omit({ id: true });
export type InsertPacketEvent = z.infer<typeof insertPacketEventSchema>;

export const insertFlowEventSchema = createInsertSchema(flowEvents).omit({ id: true });
export type InsertFlowEvent = z.infer<typeof insertFlowEventSchema>;

export const insertDeviceBaselineSchema = createInsertSchema(deviceBaselines).omit({ id: true });
export type InsertDeviceBaseline = z.infer<typeof insertDeviceBaselineSchema>;

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;

// ==================== SELECT TYPES ====================

export type Device = typeof devices.$inferSelect;
export type DeviceGroup = typeof deviceGroups.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type QuarantineRecord = typeof quarantineRecords.$inferSelect;
export type LogEntry = typeof logs.$inferSelect;
export type TrafficDataPoint = typeof trafficData.$inferSelect;
export type PacketEvent = typeof packetEvents.$inferSelect;
export type FlowEvent = typeof flowEvents.$inferSelect;
export type DeviceBaseline = typeof deviceBaselines.$inferSelect;
export type User = typeof users.$inferSelect;
export type Settings = typeof settings.$inferSelect;

// ==================== VALIDATION SCHEMAS ====================

// Auth Schema
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginCredentials = z.infer<typeof loginSchema>;

// Dashboard Stats
export const dashboardStatsSchema = z.object({
  totalDevices: z.number(),
  approvedDevices: z.number(),
  pendingApprovals: z.number(),
  activeAlerts: z.number(),
  quarantinedDevices: z.number(),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

// Settings update schema
export const updateSettingsSchema = z.object({
  anomalySensitivity: z.enum(["low", "medium", "high"]).optional(),
  alertRefreshInterval: z.number().optional(),
  theme: z.enum(["light", "dark"]).optional(),
  learningDurationSeconds: z.number().optional(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
