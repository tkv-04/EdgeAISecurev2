/**
 * Protocol Detection Utility
 * 
 * Maps port numbers to protocol names and detects suspicious ports
 */

// Well-known ports and their protocols
export const KNOWN_PORTS: Record<number, { protocol: string; description: string }> = {
    // Web
    80: { protocol: "HTTP", description: "Web traffic (unencrypted)" },
    443: { protocol: "HTTPS", description: "Secure web traffic" },
    8080: { protocol: "HTTP-ALT", description: "Alternative HTTP" },
    8443: { protocol: "HTTPS-ALT", description: "Alternative HTTPS" },

    // Email
    25: { protocol: "SMTP", description: "Email sending" },
    465: { protocol: "SMTPS", description: "Secure email sending" },
    587: { protocol: "SMTP-SUB", description: "Email submission" },
    110: { protocol: "POP3", description: "Email retrieval" },
    995: { protocol: "POP3S", description: "Secure email retrieval" },
    143: { protocol: "IMAP", description: "Email access" },
    993: { protocol: "IMAPS", description: "Secure email access" },

    // File Transfer
    20: { protocol: "FTP-DATA", description: "FTP data transfer" },
    21: { protocol: "FTP", description: "File transfer" },
    22: { protocol: "SSH", description: "Secure shell" },
    23: { protocol: "TELNET", description: "Telnet (insecure)" },
    69: { protocol: "TFTP", description: "Trivial file transfer" },

    // DNS & Network
    53: { protocol: "DNS", description: "Domain name resolution" },
    67: { protocol: "DHCP-S", description: "DHCP server" },
    68: { protocol: "DHCP-C", description: "DHCP client" },
    123: { protocol: "NTP", description: "Time synchronization" },
    161: { protocol: "SNMP", description: "Network management" },

    // Database
    1433: { protocol: "MSSQL", description: "Microsoft SQL Server" },
    1521: { protocol: "ORACLE", description: "Oracle database" },
    3306: { protocol: "MYSQL", description: "MySQL database" },
    5432: { protocol: "POSTGRESQL", description: "PostgreSQL database" },
    6379: { protocol: "REDIS", description: "Redis cache" },
    27017: { protocol: "MONGODB", description: "MongoDB database" },

    // Messaging & IoT
    1883: { protocol: "MQTT", description: "IoT messaging" },
    8883: { protocol: "MQTTS", description: "Secure IoT messaging" },
    5222: { protocol: "XMPP", description: "Chat messaging" },
    5672: { protocol: "AMQP", description: "Message queue" },

    // Remote Desktop
    3389: { protocol: "RDP", description: "Remote desktop" },
    5900: { protocol: "VNC", description: "Virtual network computing" },

    // Other common
    445: { protocol: "SMB", description: "Windows file sharing" },
    139: { protocol: "NETBIOS", description: "NetBIOS session" },
    389: { protocol: "LDAP", description: "Directory services" },
    636: { protocol: "LDAPS", description: "Secure directory services" },
};

// Suspicious/dangerous ports that warrant alerts
export const SUSPICIOUS_PORTS: Record<number, { severity: "high" | "medium" | "low"; reason: string }> = {
    // High severity - commonly used for attacks
    4444: { severity: "high", reason: "Metasploit default listener port" },
    5555: { severity: "high", reason: "Android Debug Bridge - potential backdoor" },
    6666: { severity: "high", reason: "IRC backdoor/botnet common port" },
    6667: { severity: "high", reason: "IRC - commonly used for botnets" },
    6668: { severity: "high", reason: "IRC - commonly used for botnets" },
    6669: { severity: "high", reason: "IRC - commonly used for botnets" },
    31337: { severity: "high", reason: "Back Orifice trojan" },
    12345: { severity: "high", reason: "NetBus trojan" },
    27374: { severity: "high", reason: "SubSeven trojan" },
    1234: { severity: "high", reason: "Common malware port" },
    9001: { severity: "medium", reason: "Tor network port" },
    9050: { severity: "medium", reason: "Tor SOCKS proxy" },

    // Medium severity - should be monitored
    23: { severity: "medium", reason: "Telnet - unencrypted and insecure" },
    21: { severity: "medium", reason: "FTP - often used for data exfiltration" },
    25: { severity: "medium", reason: "SMTP - potential spam relay" },
    137: { severity: "medium", reason: "NetBIOS name service - SMB attacks" },
    138: { severity: "medium", reason: "NetBIOS datagram - SMB attacks" },
    139: { severity: "medium", reason: "NetBIOS session - SMB attacks" },
    445: { severity: "medium", reason: "SMB - ransomware vector" },
    3389: { severity: "medium", reason: "RDP - brute force target" },
    5900: { severity: "medium", reason: "VNC - often misconfigured" },

    // Low severity - unusual for IoT
    1080: { severity: "low", reason: "SOCKS proxy - potential tunneling" },
    8888: { severity: "low", reason: "Alternative HTTP - check if expected" },
    9999: { severity: "low", reason: "Common test port - verify if legitimate" },
};

// Ports that are unusual for IoT devices
export const IOT_UNUSUAL_PORTS = [
    3389, 5900, 22, 23, 25, 445, 139, 137, 138, // Remote access/file sharing
    1433, 1521, 3306, 5432, 27017, 6379, // Databases
    9001, 9050, 1080, // Proxies/Tor
];

/**
 * Get protocol name for a port
 */
export function getProtocolName(port: number, proto: string = "TCP"): string {
    const known = KNOWN_PORTS[port];
    if (known) {
        return known.protocol;
    }
    return `${proto}/${port}`;
}

/**
 * Get full protocol info
 */
export function getProtocolInfo(port: number): { protocol: string; description: string } | null {
    return KNOWN_PORTS[port] || null;
}

/**
 * Check if a port is suspicious
 */
export function isSuspiciousPort(port: number): { suspicious: boolean; severity?: string; reason?: string } {
    const suspicion = SUSPICIOUS_PORTS[port];
    if (suspicion) {
        return { suspicious: true, severity: suspicion.severity, reason: suspicion.reason };
    }
    return { suspicious: false };
}

/**
 * Check if port is unusual for IoT devices
 */
export function isUnusualForIoT(port: number): boolean {
    return IOT_UNUSUAL_PORTS.includes(port);
}

/**
 * Analyze a connection and return protocol info + any warnings
 */
export function analyzeConnection(
    destPort: number,
    proto: string = "TCP",
    deviceType: string = "iot"
): {
    protocolName: string;
    description: string | null;
    isSuspicious: boolean;
    severity: string | null;
    alerts: string[];
} {
    const protocolInfo = getProtocolInfo(destPort);
    const suspicion = isSuspiciousPort(destPort);
    const unusualForIoT = deviceType === "iot" && isUnusualForIoT(destPort);

    const alerts: string[] = [];

    if (suspicion.suspicious) {
        alerts.push(`⚠️ ${suspicion.severity?.toUpperCase()}: ${suspicion.reason}`);
    }

    if (unusualForIoT && !suspicion.suspicious) {
        alerts.push(`⚠️ Unusual port for IoT device: ${destPort}`);
    }

    // High-numbered random ports are normal for client connections
    // But if an IoT device is LISTENING on unusual ports, that's suspicious

    return {
        protocolName: protocolInfo?.protocol || `${proto}/${destPort}`,
        description: protocolInfo?.description || null,
        isSuspicious: suspicion.suspicious,
        severity: suspicion.severity || null,
        alerts,
    };
}
