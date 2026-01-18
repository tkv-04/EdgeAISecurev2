import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface OnlineStatusBadgeProps {
  isOnline: boolean;
  lastSeen?: string | Date;
  showLabel?: boolean;
}

export function OnlineStatusBadge({ isOnline, lastSeen, showLabel = false }: OnlineStatusBadgeProps) {
  const formatLastSeen = () => {
    if (!lastSeen) return "Never";
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 cursor-default">
          <span
            className={cn(
              "relative flex h-2.5 w-2.5",
            )}
          >
            {isOnline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex rounded-full h-2.5 w-2.5",
                isOnline ? "bg-green-500" : "bg-gray-400"
              )}
            />
          </span>
          {showLabel && (
            <span className={cn(
              "text-xs font-medium",
              isOnline ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
            )}>
              {isOnline ? "Online" : "Offline"}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <div className="text-xs">
          <p className="font-medium">{isOnline ? "Online" : "Offline"}</p>
          <p className="text-muted-foreground">Last seen: {formatLastSeen()}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
