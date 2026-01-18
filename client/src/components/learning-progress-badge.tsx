import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Brain, Loader2 } from "lucide-react";

interface LearningProgressBadgeProps {
  isLearning: boolean;
  progress: number;  // 0-100
  showTooltip?: boolean;
}

export function LearningProgressBadge({ 
  isLearning, 
  progress,
  showTooltip = true,
}: LearningProgressBadgeProps) {
  if (!isLearning) {
    return null;  // Don't show if not learning
  }

  const badge = (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/20 text-blue-500 border border-blue-500/30 rounded-full text-xs">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span className="font-medium">{progress}%</span>
    </div>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="w-48">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              <span className="font-medium">Learning in progress</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {progress < 100 
                ? `${progress}% complete - learning normal behavior patterns`
                : "Complete - AI model will train soon"
              }
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
