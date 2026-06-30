import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useProjects } from "@/hooks/use-projects";
import { useCustomers } from "@/hooks/use-customers";
import { VariationCard } from "@/components/quotes/variation-card";
import type {
  Project,
  ProjectStage,
  Variation,
  VariationStatus,
} from "@/types";
import { VARIATION_STATUSES, PROJECT_STAGES } from "@/types";

function useAllVariations() {
  return useQuery({
    queryKey: ["variations", "all"],
    queryFn: async (): Promise<Variation[]> => {
      const { data, error } = await supabase
        .from("variations")
        .select("*")
        .order("variation_number");
      if (error) throw error;
      return data as Variation[];
    },
  });
}

export default function VariationsRoute() {
  const { data: variations = [], isLoading } = useAllVariations();
  const { data: projects = [] } = useProjects();
  const { data: customers = [] } = useCustomers();

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p as Project])),
    [projects],
  );
  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  const [statusFilter, setStatusFilter] = useState<VariationStatus | "all">(
    "all",
  );
  const [stageFilter, setStageFilter] = useState<ProjectStage | "all">("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");

  const visible = variations.filter((v) => {
    if (statusFilter !== "all" && v.status !== statusFilter) return false;
    const project = projectMap.get(v.project_id);
    if (!project) return false;
    if (stageFilter !== "all" && project.stage !== stageFilter) return false;
    if (customerFilter !== "all" && project.customer_id !== customerFilter)
      return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Variations</h1>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          Change-order documents off awarded quotes. Filter by status / stage /
          customer.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 items-end p-3 rounded-md border border-border bg-card">
        <Filter
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as VariationStatus | "all")}
          options={[
            { value: "all", label: "All" },
            ...VARIATION_STATUSES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Filter
          label="Project stage"
          value={stageFilter}
          onChange={(v) => setStageFilter(v as ProjectStage | "all")}
          options={[
            { value: "all", label: "All" },
            ...PROJECT_STAGES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Filter
          label="Customer"
          value={customerFilter}
          onChange={setCustomerFilter}
          options={[
            { value: "all", label: "All" },
            ...customers.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <div className="ml-auto text-[11px] font-mono text-muted-foreground pb-1">
          Showing {visible.length} of {variations.length}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs font-mono text-muted-foreground">Loading variations…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm font-mono text-muted-foreground rounded-md border border-dashed border-border bg-muted/40 p-6">
          No variations match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((variation) => {
            const project = projectMap.get(variation.project_id);
            const customer = project?.customer_id
              ? customerMap.get(project.customer_id)
              : undefined;
            return (
              <div key={variation.id} className="space-y-1">
                <VariationCard variation={variation} />
                <div className="text-[11px] font-mono text-muted-foreground px-3">
                  {project?.project_name ?? project?.project_number ?? "Project"}
                  {customer ? ` · ${customer.name}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:border-pac-blue-600 outline-none min-w-[140px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
