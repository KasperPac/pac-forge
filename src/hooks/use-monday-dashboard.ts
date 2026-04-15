import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface StatusEntry {
  label: string;
  count: number;
  color: string;
}

export interface GroupProgress {
  label: string;
  total: number;
  done: number;
  pct: number;
}

export interface ActiveItem {
  id: string;
  name: string;
  status: string;
  statusColor: string;
  priority: string;
  priorityColor: string;
  group: string;
}

export interface MondayDashboardData {
  total: number;
  done: number;
  completionPct: number;
  statusCounts: StatusEntry[];
  priorityCounts: StatusEntry[];
  groupProgress: GroupProgress[];
  statusByPriority: Record<string, Record<string, number>>;
  activeItems: ActiveItem[];
  statusColors: Record<string, string>;
  priorityColors: Record<string, string>;
  fetchedAt: string;
}

async function fetchDashboardData(): Promise<MondayDashboardData> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/monday-dashboard`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Failed to fetch dashboard data");
  }

  return res.json();
}

export function useMondayDashboard() {
  return useQuery({
    queryKey: ["monday-dashboard"],
    queryFn: fetchDashboardData,
    staleTime: 5 * 60 * 1000, // 5 min cache
    refetchInterval: 10 * 60 * 1000, // auto-refresh every 10 min
    retry: 1,
  });
}
