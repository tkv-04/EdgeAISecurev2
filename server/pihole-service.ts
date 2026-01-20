/**
 * Pi-hole Integration Service
 * 
 * Provides DNS-based blocking for malicious devices via Pi-hole
 * and retrieves Pi-hole statistics for the dashboard
 */

import { execSync, exec } from "child_process";

// Pi-hole configuration
const PIHOLE_COMMENT = "EdgeAISecure-AutoBlock";

/**
 * Block a device's IP via Pi-hole DNS
 * This adds the IP to Pi-hole's denylist
 */
export async function blockDeviceViaDns(ipAddress: string, deviceName: string): Promise<boolean> {
    try {
        // Pi-hole v6 uses "pihole deny" to add to blocklist
        const comment = `${PIHOLE_COMMENT}: ${deviceName}`;
        execSync(`sudo pihole deny ${ipAddress} --comment "${comment}"`, { encoding: "utf-8", timeout: 10000 });
        console.log(`[Pi-hole] Blocked device ${deviceName} (${ipAddress}) via DNS`);
        return true;
    } catch (error) {
        console.error(`[Pi-hole] Failed to block ${ipAddress}:`, error);
        return false;
    }
}

/**
 * Unblock a device's IP from Pi-hole DNS
 * This removes the IP from Pi-hole's denylist
 */
export async function unblockDeviceViaDns(ipAddress: string): Promise<boolean> {
    try {
        execSync(`sudo pihole deny -d ${ipAddress}`, { encoding: "utf-8", timeout: 10000 });
        console.log(`[Pi-hole] Unblocked ${ipAddress} from DNS`);
        return true;
    } catch (error) {
        console.error(`[Pi-hole] Failed to unblock ${ipAddress}:`, error);
        return false;
    }
}

/**
 * Block a domain via Pi-hole
 * Useful for blocking malicious C2 domains
 */
export async function blockDomain(domain: string, reason?: string): Promise<boolean> {
    try {
        const comment = reason ? `${PIHOLE_COMMENT}: ${reason}` : PIHOLE_COMMENT;
        execSync(`sudo pihole deny ${domain} --comment "${comment}"`, { encoding: "utf-8", timeout: 10000 });
        console.log(`[Pi-hole] Blocked domain: ${domain}`);
        return true;
    } catch (error) {
        console.error(`[Pi-hole] Failed to block domain ${domain}:`, error);
        return false;
    }
}

/**
 * Get Pi-hole statistics by parsing command output
 */
export async function getPiholeStats(): Promise<{
    status: "enabled" | "disabled" | "unknown";
    totalQueries: number;
    blockedQueries: number;
    percentBlocked: number;
    domainsOnBlocklist: number;
    privacyLevel: number;
}> {
    try {
        // Get Pi-hole status
        let status: "enabled" | "disabled" | "unknown" = "unknown";
        try {
            const statusOutput = execSync("sudo pihole status", { encoding: "utf-8", timeout: 5000 });
            if (statusOutput.includes("enabled") || statusOutput.includes("active")) {
                status = "enabled";
            } else if (statusOutput.includes("disabled")) {
                status = "disabled";
            }
        } catch {
            status = "unknown";
        }

        // Get stats from Pi-hole's stats command
        let totalQueries = 0;
        let blockedQueries = 0;
        let percentBlocked = 0;
        let domainsOnBlocklist = 0;

        try {
            // Try to get stats from the API endpoint if available
            const statsOutput = execSync("curl -s http://localhost/api/stats/summary 2>/dev/null || echo '{}'", { encoding: "utf-8", timeout: 5000 });
            if (statsOutput && statsOutput.trim() !== "{}") {
                const stats = JSON.parse(statsOutput);
                totalQueries = stats.queries?.total || 0;
                blockedQueries = stats.queries?.blocked || 0;
                percentBlocked = stats.queries?.percent_blocked || 0;
                domainsOnBlocklist = stats.gravity?.domains_being_blocked || 0;
            }
        } catch {
            // Fallback: try to parse from gravity
            try {
                const gravityOutput = execSync("sudo wc -l /etc/pihole/gravity.db 2>/dev/null || echo '0'", { encoding: "utf-8", timeout: 5000 });
                domainsOnBlocklist = parseInt(gravityOutput.trim()) || 0;
            } catch {
                domainsOnBlocklist = 0;
            }
        }

        return {
            status,
            totalQueries,
            blockedQueries,
            percentBlocked,
            domainsOnBlocklist,
            privacyLevel: 0,
        };
    } catch (error) {
        console.error("[Pi-hole] Failed to get stats:", error);
        return {
            status: "unknown",
            totalQueries: 0,
            blockedQueries: 0,
            percentBlocked: 0,
            domainsOnBlocklist: 0,
            privacyLevel: 0,
        };
    }
}

/**
 * Get recent DNS queries for a specific client IP
 */
export async function getClientQueries(clientIp: string, limit: number = 20): Promise<{
    domain: string;
    timestamp: Date;
    blocked: boolean;
}[]> {
    try {
        // Query Pi-hole for this client's DNS requests
        const output = execSync(`sudo pihole -q ${clientIp} 2>/dev/null | head -${limit}`, { encoding: "utf-8", timeout: 10000 });

        // Parse output (format varies by Pi-hole version)
        const queries: { domain: string; timestamp: Date; blocked: boolean }[] = [];
        const lines = output.split("\n").filter(Boolean);

        for (const line of lines) {
            // Basic parsing - actual format depends on Pi-hole version
            if (line.includes(clientIp)) {
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    queries.push({
                        domain: parts[parts.length - 1] || "unknown",
                        timestamp: new Date(),
                        blocked: line.toLowerCase().includes("blocked") || line.includes("Pi-holed"),
                    });
                }
            }
        }

        return queries;
    } catch (error) {
        console.error(`[Pi-hole] Failed to get queries for ${clientIp}:`, error);
        return [];
    }
}

/**
 * Get devices blocked by EdgeAISecure via Pi-hole
 */
export async function getEdgeAISecureBlocked(): Promise<string[]> {
    try {
        const output = execSync(`sudo pihole deny -l 2>/dev/null | grep "${PIHOLE_COMMENT}" || echo ""`, { encoding: "utf-8", timeout: 10000 });
        const blocked = output.split("\n").filter(Boolean);
        return blocked;
    } catch (error) {
        console.error("[Pi-hole] Failed to get blocked list:", error);
        return [];
    }
}

/**
 * Check if Pi-hole is available and working
 */
export async function checkPiholeStatus(): Promise<{
    installed: boolean;
    running: boolean;
    version: string;
}> {
    try {
        const versionOutput = execSync("pihole -v 2>/dev/null || echo 'not found'", { encoding: "utf-8", timeout: 5000 });
        const installed = !versionOutput.includes("not found");

        let running = false;
        try {
            execSync("pgrep -x pihole-FTL", { encoding: "utf-8", timeout: 3000 });
            running = true;
        } catch {
            running = false;
        }

        // Extract version
        const versionMatch = versionOutput.match(/Pi-hole version is v?(\S+)/);
        const version = versionMatch ? versionMatch[1] : "unknown";

        return { installed, running, version };
    } catch {
        return { installed: false, running: false, version: "unknown" };
    }
}
