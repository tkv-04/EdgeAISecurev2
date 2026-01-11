import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Brain } from "lucide-react";

interface AIConfidenceBadgeProps {
  confidence: number;  // 0-1
  samples: number;
  hasModel: boolean;
  showTooltip?: boolean;
  size?: "sm" | "md";
}

export function AIConfidenceBadge({ 
  confidence, 
  samples, 
  hasModel,
  showTooltip = true,
  size = "sm"
}: AIConfidenceBadgeProps) {
  // Determine confidence level
  const level = !hasModel ? "none" : 
    confidence >= 0.8 ? "high" : 
    confidence >= 0.3 ? "medium" : "low";

  const colors = {
    high: "bg-green-500/20 text-green-500 border-green-500/30",
    medium: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    low: "bg-red-500/20 text-red-500 border-red-500/30",
    none: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  const labels = {
    high: "High",
    medium: "Medium",
    low: "Low",
    none: "No AI",
  };

  const sizeClasses = size === "sm" 
    ? "h-5 text-xs px-1.5 gap-1" 
    : "h-6 text-sm px-2 gap-1.5";

  const badge = (
    <div className={`inline-flex items-center rounded-full border ${colors[level]} ${sizeClasses}`}>
      <Brain className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span className="font-medium">{labels[level]}</span>
    </div>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-1">
            <div className="font-medium">AI Model Status</div>
            {hasModel ? (
              <>
                <div>Confidence: {Math.round(confidence * 100)}%</div>
                <div>Training samples: {samples}</div>
              </>
            ) : (
              <div>No AI model trained yet</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
