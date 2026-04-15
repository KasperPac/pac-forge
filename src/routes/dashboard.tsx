import { LayoutDashboard, RefreshCw, ExternalLink, Clock, CheckCircle2, AlertTriangle, Loader2, Hammer } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend as RechartsLegend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useMondayDashboard } from "@/hooks/use-monday-dashboard";
import type { ActiveItem } from "@/hooks/use-monday-dashboard";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Status ordering + color overrides for dark theme readability
// ---------------------------------------------------------------------------

const STATUS_ORDER = [
  "Working on it",
  "Fixing",
  "Awaiting Testing",
  "Task Created",
  "Planned",
  "Test Failed",
  "Done",
  "No Status",
];

const CHART_STATUS_COLORS: Record<string, string> = {
  "Done": "#22c55e",
  "Working on it": "#f59e0b",
  "Fixing": "#f97316",
  "Awaiting Testing": "#a855f7",
  "Task Created": "#3b82f6",
  "Planned": "#6b7280",
  "Test Failed": "#ef4444",
  "No Status": "#404040",
};

const PRIORITY_CHART_COLORS: Record<string, string> = {
  "Critical": "#ef4444",
  "High": "#a855f7",
  "Medium": "#6366f1",
  "Low": "#3b82f6",
  "Unset": "#404040",
};

// ---------------------------------------------------------------------------
// Recharts custom tooltip + legend
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; payload: { color?: string; fill?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color || p.payload.color || p.payload.fill }}
          />
          <span style={{ color: "hsl(var(--muted-foreground))" }}>{p.name}:</span>
          <span className="font-mono font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Custom legend that doesn't inherit recharts' inline color styles. */
function ChartLegend({
  payload,
}: {
  payload?: Array<{ value: string; color: string }>;
}) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-mono text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  icon: typeof CheckCircle2;
  accent?: string;
  sub?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" style={accent ? { color: accent } : undefined} />
        {label}
      </div>
      <div className="font-mono text-2xl font-semibold tracking-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Group progress row
// ---------------------------------------------------------------------------

function GroupProgressRow({ label, done, total, pct }: { label: string; done: number; total: number; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">
          {done}/{total} <span className="text-[10px]">({pct}%)</span>
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active item row
// ---------------------------------------------------------------------------

function ActiveItemRow({ item }: { item: ActiveItem }) {
  // Extract task ID prefix (e.g., "FEAT-01", "BUG-03")
  const idMatch = item.name.match(/^([A-Z]+-\d+)/);
  const taskId = idMatch?.[1];
  const title = taskId ? item.name.slice(taskId.length).replace(/^[:\s]+/, "") : item.name;

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/30">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: item.statusColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {taskId && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {taskId}
            </span>
          )}
          <span className="truncate">{title}</span>
        </div>
      </div>
      <Badge
        variant="outline"
        className="shrink-0 font-mono text-[10px]"
        style={{
          borderColor: item.statusColor + "60",
          color: item.statusColor,
        }}
      >
        {item.status}
      </Badge>
      {item.priority !== "Unset" && (
        <Badge
          variant="outline"
          className="shrink-0 font-mono text-[10px]"
          style={{
            borderColor: item.priorityColor + "60",
            color: item.priorityColor,
          }}
        >
          {item.priority}
        </Badge>
      )}
      <span className="shrink-0 text-[10px] text-muted-foreground">{item.group}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { data, isLoading, error, dataUpdatedAt } = useMondayDashboard();
  const qc = useQueryClient();

  const refresh = () => qc.invalidateQueries({ queryKey: ["monday-dashboard"] });

  // Sort status data in pipeline order
  const sortedStatus = data?.statusCounts
    .filter((s) => s.label !== "No Status")
    .sort((a, b) => STATUS_ORDER.indexOf(a.label) - STATUS_ORDER.indexOf(b.label))
    .map((s) => ({ ...s, color: CHART_STATUS_COLORS[s.label] || s.color })) ?? [];

  // Sort priority data
  const PRIO_ORDER = ["Critical", "High", "Medium", "Low", "Unset"];
  const sortedPriority = data?.priorityCounts
    .filter((p) => p.label !== "Unset")
    .sort((a, b) => PRIO_ORDER.indexOf(a.label) - PRIO_ORDER.indexOf(b.label))
    .map((p) => ({ ...p, color: PRIORITY_CHART_COLORS[p.label] || p.color })) ?? [];

  // For stacked bar: build per-status rows with priority breakdowns
  const stackedData = data
    ? STATUS_ORDER.filter((s) => s !== "Done" && s !== "No Status" && data.statusByPriority[s])
        .map((status) => {
          const row: Record<string, string | number> = { status };
          const prios = data.statusByPriority[status] || {};
          for (const p of PRIO_ORDER) {
            row[p] = prios[p] || 0;
          }
          return row;
        })
    : [];

  // Counts for metric cards
  const awaitingTesting = data?.statusCounts.find((s) => s.label === "Awaiting Testing")?.count ?? 0;
  const workingOn = data?.statusCounts.find((s) => s.label === "Working on it")?.count ?? 0;
  const fixing = data?.statusCounts.find((s) => s.label === "Fixing")?.count ?? 0;
  const activeWip = workingOn + fixing;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">PAC-FORGE</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="h-6 w-6" />
            Build Tracker
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live progress from the Monday.com task board
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://pac-technologies-company.monday.com/boards/5092432355"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Monday
            </a>
          </Button>
        </div>
      </div>

      <Separator />

      {/* Loading / error states */}
      {isLoading && !data && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading board data...
        </div>
      )}

      {error && !data && (
        <Card className="p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            Failed to load Monday data. Make sure <code className="font-mono text-xs">MONDAY_API_KEY</code> is set in Supabase secrets.
          </p>
          <p className="mt-1 font-mono text-xs text-destructive">{String(error)}</p>
        </Card>
      )}

      {data && (
        <>
          {/* ── Metric cards ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Total Items"
              value={data.total}
              icon={LayoutDashboard}
            />
            <MetricCard
              label="Completed"
              value={data.done}
              icon={CheckCircle2}
              accent="#22c55e"
              sub={`${data.completionPct}% done`}
            />
            <MetricCard
              label="Awaiting Testing"
              value={awaitingTesting}
              icon={Clock}
              accent="#a855f7"
              sub="Need your review"
            />
            <MetricCard
              label="Active WIP"
              value={activeWip}
              icon={Hammer}
              accent="#f59e0b"
              sub={`${workingOn} working + ${fixing} fixing`}
            />
          </div>

          {/* ── Overall progress bar ── */}
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Overall Build Progress</span>
              <span className="font-mono text-muted-foreground">
                {data.done} / {data.total}
              </span>
            </div>
            <div className="relative h-5 overflow-hidden rounded-md bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-md transition-all duration-700"
                style={{
                  width: `${data.completionPct}%`,
                  background: "linear-gradient(90deg, #22c55e 0%, #16a34a 100%)",
                }}
              />
              <span
                className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold"
                style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
              >
                {data.completionPct}%
              </span>
            </div>
          </Card>

          {/* ── Charts row ── */}
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Status donut */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium">Status Distribution</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={sortedStatus}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    strokeWidth={2}
                    stroke="hsl(var(--background))"
                  >
                    {sortedStatus.map((entry) => (
                      <Cell key={entry.label} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <RechartsLegend content={<ChartLegend />} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            {/* Priority bar chart */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium">Priority Breakdown</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={sortedPriority} barSize={32}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--accent))" }} />
                  <Bar dataKey="count" name="Items" radius={[4, 4, 0, 0]}>
                    {sortedPriority.map((entry) => (
                      <Cell key={entry.label} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* ── Stacked bar: status x priority ── */}
          {stackedData.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium">Open Items — Status by Priority</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stackedData} barSize={28}>
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--accent))" }} />
                  <RechartsLegend content={<ChartLegend />} />
                  {PRIO_ORDER.map((p) => (
                    <Bar
                      key={p}
                      dataKey={p}
                      stackId="a"
                      name={p}
                      fill={PRIORITY_CHART_COLORS[p]}
                      radius={p === "Critical" ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* ── Bottom row: group progress + active items list ── */}
          <div className="grid gap-3 lg:grid-cols-3">
            {/* Group progress */}
            <Card className="p-4 lg:col-span-1">
              <h3 className="mb-3 text-sm font-medium">Progress by Category</h3>
              <div className="space-y-4">
                {data.groupProgress.map((g) => (
                  <GroupProgressRow key={g.label} {...g} />
                ))}
              </div>
            </Card>

            {/* Active items list */}
            <Card className="flex flex-col p-4 lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Active Items
                  <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
                    {data.activeItems.length}
                  </Badge>
                </h3>
              </div>
              <ScrollArea className="flex-1" style={{ maxHeight: 360 }}>
                <div className="space-y-0.5">
                  {data.activeItems.map((item) => (
                    <ActiveItemRow key={item.id} item={item} />
                  ))}
                  {data.activeItems.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No active items
                    </p>
                  )}
                </div>
              </ScrollArea>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
