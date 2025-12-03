import { cn } from "@/lib/utils";
import type { DeviceStatus, AlertSeverity, AlertStatus } from "@shared/schema";

interface StatusBadgeProps {
  status: DeviceStatus | AlertSeverity | AlertStatus;
  className?: string;
}

const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  new: {
    bg: "bg-status-pending/15",
    text: "text-status-pending",
    dot: "bg-status-pending",
    label: "New",
  },
  approved: {
    bg: "bg-status-normal/15",
    text: "text-status-normal",
    dot: "bg-status-normal",
    label: "Approved",
  },
  monitoring: {
    bg: "bg-status-suspicious/15",
    text: "text-status-suspicious",
    dot: "bg-status-suspicious",
    label: "Monitoring",
  },
  quarantined: {
    bg: "bg-status-danger/15",
    text: "text-status-danger",
    dot: "bg-status-danger",
    label: "Quarantined",
  },
  blocked: {
    bg: "bg-status-blocked/15",
    text: "text-status-blocked",
    dot: "bg-status-blocked",
    label: "Blocked",
  },
  low: {
    bg: "bg-status-normal/15",
    text: "text-status-normal",
    dot: "bg-status-normal",
    label: "Low",
  },
  medium: {
    bg: "bg-status-suspicious/15",
    text: "text-status-suspicious",
    dot: "bg-status-suspicious",
    label: "Medium",
  },
  high: {
    bg: "bg-status-danger/15",
    text: "text-status-danger",
    dot: "bg-status-danger",
    label: "High",
  },
  open: {
    bg: "bg-status-danger/15",
    text: "text-status-danger",
    dot: "bg-status-danger",
    label: "Open",
  },
  acknowledged: {
    bg: "bg-status-suspicious/15",
    text: "text-status-suspicious",
    dot: "bg-status-suspicious",
    label: "Acknowledged",
  },
  resolved: {
    bg: "bg-status-normal/15",
    text: "text-status-normal",
    dot: "bg-status-normal",
    label: "Resolved",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.new;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        config.bg,
        config.text,
        className
      )}
      aria-label={`Status: ${config.label}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
