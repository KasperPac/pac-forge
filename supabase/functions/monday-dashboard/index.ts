// Supabase Edge Function: Monday.com board data proxy for in-app dashboard.
// Fetches board items via Monday GraphQL API and returns aggregated stats.
// Requires MONDAY_API_KEY secret set via: npx supabase secrets set MONDAY_API_KEY=...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MONDAY_API_URL = "https://api.monday.com/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Board config (matches monday.config.json)
const BOARD_ID = "5092432355";
const STATUS_COL = "status_cdbba809";
const PRIORITY_COL = "color_mm21es1p";

const GROUP_LABELS: Record<string, string> = {
  group_mm0znpgf: "New Features",
  group_mm0z5fcq: "Bug Fixes",
  group_mm0ztp9x: "Improvements",
  group_mm1xfb60: "Wishlist",
  group_mm0zcw7h: "Complete",
};

const STATUS_COLORS: Record<string, string> = {
  "Working on it": "#fdab3d",
  "Done": "#00c875",
  "Test Failed": "#bb3354",
  "Awaiting Testing": "#9d50dd",
  "Task Created": "#579bfc",
  "Planned": "#757575",
  "Fixing": "#ff6d3b",
};


const PRIORITY_COLORS: Record<string, string> = {
  "Critical": "#e8384f",
  "High": "#7c3aed",
  "Medium": "#5559df",
  "Low": "#579bfc",
  "Unset": "#6b7280",
};

interface MondayItem {
  id: string;
  name: string;
  group: { id: string; title: string };
  column_values: Array<{
    id: string;
    text: string | null;
    value: string | null;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const mondayKey = Deno.env.get("MONDAY_API_KEY");
    if (!mondayKey) return jsonResponse({ error: "MONDAY_API_KEY not configured" }, 500);

    // Fetch all items with status, priority, and group info
    // Monday paginates at 500 items per page
    let allItems: MondayItem[] = [];
    let cursor: string | null = null;
    let page = 0;

    do {
      const cursorClause = cursor ? `cursor: "${cursor}"` : "";
      const query = page === 0
        ? `{
            boards(ids: ${BOARD_ID}) {
              items_page(limit: 500) {
                cursor
                items {
                  id name
                  group { id title }
                  column_values(ids: ["${STATUS_COL}", "${PRIORITY_COL}"]) {
                    id text value
                  }
                }
              }
            }
          }`
        : `{
            next_items_page(limit: 500, ${cursorClause}) {
              cursor
              items {
                id name
                group { id title }
                column_values(ids: ["${STATUS_COL}", "${PRIORITY_COL}"]) {
                  id text value
                }
              }
            }
          }`;

      const res = await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: mondayKey,
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const txt = await res.text();
        return jsonResponse({ error: `Monday API error: ${txt}` }, 502);
      }

      const json = await res.json();
      const pageData = page === 0
        ? json.data?.boards?.[0]?.items_page
        : json.data?.next_items_page;

      if (!pageData) break;

      allItems = allItems.concat(pageData.items || []);
      cursor = pageData.cursor;
      page++;
    } while (cursor && page < 5); // safety limit

    // Aggregate
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const groupCounts: Record<string, { total: number; done: number; label: string }> = {};
    const statusByPriority: Record<string, Record<string, number>> = {};
    const activeItems: Array<{
      id: string;
      name: string;
      status: string;
      statusColor: string;
      priority: string;
      priorityColor: string;
      group: string;
    }> = [];

    for (const item of allItems) {
      const statusCol = item.column_values.find((c) => c.id === STATUS_COL);
      const priorityCol = item.column_values.find((c) => c.id === PRIORITY_COL);

      const status = statusCol?.text || "No Status";
      const priority = priorityCol?.text || "Unset";
      const groupId = item.group?.id || "unknown";
      const groupLabel = item.group?.title || GROUP_LABELS[groupId] || groupId;

      // Status counts
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Priority counts
      priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;

      // Group counts
      if (!groupCounts[groupLabel]) {
        groupCounts[groupLabel] = { total: 0, done: 0, label: groupLabel };
      }
      groupCounts[groupLabel].total++;
      if (status === "Done") groupCounts[groupLabel].done++;

      // Status x Priority matrix
      if (!statusByPriority[status]) statusByPriority[status] = {};
      statusByPriority[status][priority] = (statusByPriority[status][priority] || 0) + 1;

      // Active items (non-Done, non-blank status)
      if (status !== "Done" && status !== "No Status") {
        activeItems.push({
          id: item.id,
          name: item.name,
          status,
          statusColor: STATUS_COLORS[status] || "#6b7280",
          priority,
          priorityColor: PRIORITY_COLORS[priority] || "#6b7280",
          group: groupLabel,
        });
      }
    }

    // Build response
    const total = allItems.length;
    const done = statusCounts["Done"] || 0;

    return jsonResponse({
      total,
      done,
      completionPct: total > 0 ? Math.round((done / total) * 1000) / 10 : 0,
      statusCounts: Object.entries(statusCounts).map(([label, count]) => ({
        label,
        count,
        color: STATUS_COLORS[label] || "#6b7280",
      })),
      priorityCounts: Object.entries(priorityCounts).map(([label, count]) => ({
        label,
        count,
        color: PRIORITY_COLORS[label] || "#6b7280",
      })),
      groupProgress: Object.values(groupCounts)
        .filter((g) => g.label !== "Complete")
        .map((g) => ({
          label: g.label,
          total: g.total,
          done: g.done,
          pct: g.total > 0 ? Math.round((g.done / g.total) * 1000) / 10 : 0,
        })),
      statusByPriority,
      activeItems: activeItems.sort((a, b) => {
        // Sort: Working > Fixing > Awaiting Testing > Task Created > Planned
        const order: Record<string, number> = {
          "Working on it": 0,
          "Fixing": 1,
          "Awaiting Testing": 2,
          "Task Created": 3,
          "Planned": 4,
          "Test Failed": 5,
        };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      }),
      statusColors: STATUS_COLORS,
      priorityColors: PRIORITY_COLORS,
      fetchedAt: new Date().toISOString(),
    }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
