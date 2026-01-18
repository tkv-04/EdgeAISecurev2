import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

interface BehaviorChartProps {
  protocols: string[];
  activeHours: Record<string, number>;
  avgTrafficRate: number;
  flowsAnalyzed: number;
}

const COLORS = [
  "hsl(217, 91%, 55%)",  // Blue
  "hsl(142, 76%, 45%)",  // Green
  "hsl(45, 93%, 50%)",   // Yellow
  "hsl(27, 87%, 55%)",   // Orange
  "hsl(340, 82%, 52%)",  // Pink
  "hsl(190, 75%, 45%)",  // Cyan
];

export function BehaviorChart({ protocols, activeHours, avgTrafficRate, flowsAnalyzed }: BehaviorChartProps) {
  // Prepare protocol data for pie chart
  const protocolData = protocols.map((protocol, index) => ({
    name: protocol.toUpperCase(),
    value: 1,  // Equal weight since we only have list, not counts
    color: COLORS[index % COLORS.length],
  }));

  // Prepare hourly activity data
  const hourlyData = Object.entries(activeHours)
    .map(([hour, count]) => ({
      hour: parseInt(hour),
      count: count as number,
    }))
    .sort((a, b) => a.hour - b.hour);

  // Find peak hours
  const peakHours = hourlyData
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(h => `${h.hour}:00`);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Protocol Distribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Protocol Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {protocolData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={protocolData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {protocolData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
              No protocol data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Behavior Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Avg Traffic</p>
              <p className="text-xl font-bold">{(avgTrafficRate / 1024).toFixed(1)} KB/s</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Flows Analyzed</p>
              <p className="text-xl font-bold">{flowsAnalyzed}</p>
            </div>
          </div>
          
          <div>
            <p className="text-xs text-muted-foreground mb-1">Peak Activity Hours</p>
            <div className="flex flex-wrap gap-1">
              {peakHours.length > 0 ? (
                peakHours.map((hour) => (
                  <span
                    key={hour}
                    className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium"
                  >
                    {hour}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No data</span>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Known Protocols</p>
            <div className="flex flex-wrap gap-1">
              {protocols.length > 0 ? (
                protocols.slice(0, 6).map((protocol) => (
                  <span
                    key={protocol}
                    className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded text-xs"
                  >
                    {protocol.toUpperCase()}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No data</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hourly Activity Heatmap */}
      <Card className="md:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">24-Hour Activity Pattern</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-0.5">
            {Array.from({ length: 24 }, (_, hour) => {
              const activity = activeHours[hour.toString()] || 0;
              const maxActivity = Math.max(...Object.values(activeHours as Record<string, number>), 1);
              const intensity = activity / maxActivity;
              
              return (
                <div
                  key={hour}
                  className="flex-1 flex flex-col items-center"
                  title={`${hour}:00 - ${activity} flows`}
                >
                  <div
                    className="w-full h-8 rounded-sm"
                    style={{
                      backgroundColor: intensity > 0
                        ? `hsl(217, 91%, ${90 - intensity * 45}%)`
                        : "hsl(0, 0%, 95%)",
                    }}
                  />
                  {hour % 6 === 0 && (
                    <span className="text-xs text-muted-foreground mt-1">{hour}</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Hour of day (darker = more activity)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
