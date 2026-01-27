import { EventEmitter } from "events";
import { storage } from "./storage";

export type NotificationType =
    | "device_discovered"
    | "device_offline"
    | "device_online"
    | "suspicious_activity"
    | "device_quarantined"
    | "auto_blocked"
    | "alert_created";

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    deviceId?: number;
    deviceName?: string;
    severity: "info" | "warning" | "critical";
    timestamp: Date;
    read: boolean;
}

export interface NotificationSettings {
    enabled: boolean;
    webhookUrl?: string;
    webhookEnabled: boolean;
    emailEnabled: boolean;
    emailAddress?: string;
    notifyOnNewDevice: boolean;
    notifyOnOffline: boolean;
    notifyOnSuspicious: boolean;
}

class NotificationService extends EventEmitter {
    private notifications: Notification[] = [];
    private settings: NotificationSettings = {
        enabled: true,
        webhookEnabled: false,
        emailEnabled: false,
        notifyOnNewDevice: true,
        notifyOnOffline: true,
        notifyOnSuspicious: true,
    };
    private maxNotifications = 100;

    constructor() {
        super();
    }

    /**
     * Get current notification settings
     */
    getSettings(): NotificationSettings {
        return { ...this.settings };
    }

    /**
     * Update notification settings
     */
    updateSettings(updates: Partial<NotificationSettings>): NotificationSettings {
        this.settings = { ...this.settings, ...updates };
        console.log("[NotificationService] Settings updated:", this.settings);
        return this.settings;
    }

    /**
     * Get all notifications
     */
    getNotifications(limit: number = 50): Notification[] {
        return this.notifications.slice(0, limit);
    }

    /**
     * Get unread count
     */
    getUnreadCount(): number {
        return this.notifications.filter(n => !n.read).length;
    }

    /**
     * Mark notification as read
     */
    markAsRead(id: string): void {
        const notification = this.notifications.find(n => n.id === id);
        if (notification) {
            notification.read = true;
        }
    }

    /**
     * Mark all as read
     */
    markAllAsRead(): void {
        this.notifications.forEach(n => n.read = true);
    }

    /**
     * Clear all notifications
     */
    clearAll(): void {
        this.notifications = [];
    }

    /**
     * Create and send a notification
     */
    async notify(
        type: NotificationType,
        title: string,
        message: string,
        options: {
            deviceId?: number;
            deviceName?: string;
            severity?: "info" | "warning" | "critical";
        } = {}
    ): Promise<Notification> {
        if (!this.settings.enabled) {
            console.log("[NotificationService] Notifications disabled, skipping");
            return {} as Notification;
        }

        const notification: Notification = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            title,
            message,
            deviceId: options.deviceId,
            deviceName: options.deviceName,
            severity: options.severity || "info",
            timestamp: new Date(),
            read: false,
        };

        // Add to in-memory store (most recent first)
        this.notifications.unshift(notification);

        // Trim to max size
        if (this.notifications.length > this.maxNotifications) {
            this.notifications = this.notifications.slice(0, this.maxNotifications);
        }

        console.log(`[NotificationService] ${notification.severity.toUpperCase()}: ${title} - ${message}`);

        // Emit event for real-time updates
        this.emit("notification", notification);

        // Send to webhook if enabled
        if (this.settings.webhookEnabled && this.settings.webhookUrl) {
            this.sendWebhook(notification);
        }

        return notification;
    }

    /**
     * Send notification to webhook
     */
    private async sendWebhook(notification: Notification): Promise<void> {
        if (!this.settings.webhookUrl) return;

        try {
            const payload = {
                content: `**${notification.title}**\n${notification.message}`,
                embeds: [{
                    title: notification.title,
                    description: notification.message,
                    color: notification.severity === "critical" ? 0xff0000 :
                        notification.severity === "warning" ? 0xffa500 : 0x00ff00,
                    timestamp: notification.timestamp.toISOString(),
                    fields: notification.deviceName ? [{
                        name: "Device",
                        value: notification.deviceName,
                        inline: true
                    }] : []
                }]
            };

            const response = await fetch(this.settings.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                console.error("[NotificationService] Webhook failed:", response.status);
            }
        } catch (error) {
            console.error("[NotificationService] Webhook error:", error);
        }
    }

    // ==================== Convenience Methods ====================

    async notifyNewDevice(deviceName: string, ipAddress: string, macAddress: string, deviceId?: number): Promise<void> {
        if (!this.settings.notifyOnNewDevice) return;

        await this.notify(
            "device_discovered",
            "New Device Discovered",
            `${deviceName} (${ipAddress}) has been detected on the network. MAC: ${macAddress}`,
            { deviceId, deviceName, severity: "info" }
        );
    }

    async notifyDeviceOffline(deviceName: string, deviceId?: number): Promise<void> {
        if (!this.settings.notifyOnOffline) return;

        await this.notify(
            "device_offline",
            "Device Offline",
            `${deviceName} has gone offline and is no longer responding.`,
            { deviceId, deviceName, severity: "warning" }
        );
    }

    async notifyDeviceOnline(deviceName: string, deviceId?: number): Promise<void> {
        await this.notify(
            "device_online",
            "Device Online",
            `${deviceName} is back online.`,
            { deviceId, deviceName, severity: "info" }
        );
    }

    async notifySuspiciousActivity(deviceName: string, reason: string, deviceId?: number): Promise<void> {
        if (!this.settings.notifyOnSuspicious) return;

        await this.notify(
            "suspicious_activity",
            "Suspicious Activity Detected",
            `${deviceName}: ${reason}`,
            { deviceId, deviceName, severity: "critical" }
        );
    }

    async notifyDeviceQuarantined(deviceName: string, reason: string, deviceId?: number): Promise<void> {
        await this.notify(
            "device_quarantined",
            "🔒 Device Quarantined",
            `${deviceName} has been auto-quarantined. Reason: ${reason}`,
            { deviceId, deviceName, severity: "warning" }
        );
    }

    async notifyAutoBlocked(deviceName: string, reason: string, deviceId?: number): Promise<void> {
        await this.notify(
            "auto_blocked",
            "🚫 Device Permanently Blocked",
            `${deviceName} has been permanently blocked (repeat offender). Reason: ${reason}`,
            { deviceId, deviceName, severity: "critical" }
        );
    }
}

// Export singleton instance
export const notificationService = new NotificationService();
