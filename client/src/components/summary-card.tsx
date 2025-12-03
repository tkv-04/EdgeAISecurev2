import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface SummaryCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: "default" | "warning" | "danger" | "success";
  className?: string;
}

const variantStyles = {
  default: "text-primary",
  warning: "text-status-suspicious",
  danger: "text-status-danger",
  success: "text-status-normal",
};

export function SummaryCard({
  title,
  value,
  icon: Icon,
  trend,
  variant = "default",
  className,
}: SummaryCardProps) {
  return (
    <Card className={cn("hover-elevate", className)} data-testid={`card-summary-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={cn("text-3xl font-semibold font-mono", variantStyles[variant])}>
              {value}
            </p>
            {trend && (
              <p
                className={cn(
                  "text-xs font-medium",
                  trend.isPositive ? "text-status-normal" : "text-status-danger"
                )}
              >
                {trend.isPositive ? "+" : "-"}
                {Math.abs(trend.value)}% from last hour
              </p>
            )}
          </div>
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              variant === "danger" ? "bg-status-danger/10" : 
              variant === "warning" ? "bg-status-suspicious/10" :
              variant === "success" ? "bg-status-normal/10" :
              "bg-primary/10"
            )}
          >
            <Icon
              className={cn("h-5 w-5", variantStyles[variant])}
              aria-hidden="true"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
