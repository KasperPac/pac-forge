/**
 * Engineer-confirm step for AI-ingested foreign specs.
 *
 * Reads the parked draft from `useIngestReviewStore`. The engineer can edit
 * unit / equipment_module / device names inline before committing. Commit calls
 * `create_draft_from_ingest` with source="foreign_ingest"; cancel drops the
 * result and returns to the spec-builder list.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useIngestReviewStore } from "@/hooks/use-spec-ingest";
import { useCreateDraftFromIngest } from "@/hooks/use-spec-revisions";
import type {
  EquipmentModuleV2,
  ControlModuleV2,
  Hierarchy,
  SpecContractV2,
  UnitV2,
} from "@/types/spec-contract-v2";

/**
 * No FDS V2 lock banner on this route: spec-builder-ingest-review is purely
 * pre-project — it reviews an ingest draft BEFORE a spec_projects row exists.
 * `confirmation_status` is a per-project gate and does not apply here. The
 * draft created from this review starts as `unconfirmed` and the lock banner
 * shows up on the subsequent /specs/:projectId/:specId/* routes.
 *
 * (FDS Engine Phase 2 — see Docs/superpowers/specs/2026-05-25-fds-engine-phase2-wizard-design.md)
 */
export default function SpecBuilderIngestReviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get("projectId");

  const parked = useIngestReviewStore((s) => s.parked);
  const clearParked = useIngestReviewStore((s) => s.clear);
  const createDraft = useCreateDraftFromIngest();

  const [draft, setDraft] = useState<SpecContractV2 | null>(null);

  useEffect(() => {
    if (parked?.draft) setDraft(parked.draft);
  }, [parked]);

  const warnings = parked?.warnings ?? [];

  const unitCount = draft?.hierarchy.units.length ?? 0;
  const equipment_moduleCount = useMemo(
    () =>
      draft?.hierarchy.units.reduce(
        (n, s) => n + s.equipment_modules.length,
        0,
      ) ?? 0,
    [draft],
  );
  const deviceCount = useMemo(
    () =>
      draft?.hierarchy.units.reduce(
        (n, s) =>
          n + s.equipment_modules.reduce((m, a) => m + a.control_modules.length, 0),
        0,
      ) ?? 0,
    [draft],
  );

  if (!parked || !draft) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          No ingest result to review. Upload a DOCX from the Spec Builder page.
        </p>
        <Button variant="outline" onClick={() => navigate("/specs")}>
          Back to Spec Builder
        </Button>
      </div>
    );
  }

  const updateSubsystem = (subId: string, patch: Partial<UnitV2>) => {
    setDraft((prev) =>
      prev ? { ...prev, hierarchy: updateSub(prev.hierarchy, subId, patch) } : prev,
    );
  };
  const updateAssembly = (asyId: string, patch: Partial<EquipmentModuleV2>) => {
    setDraft((prev) =>
      prev ? { ...prev, hierarchy: updateAsy(prev.hierarchy, asyId, patch) } : prev,
    );
  };
  const updateDevice = (devId: string, patch: Partial<ControlModuleV2>) => {
    setDraft((prev) =>
      prev ? { ...prev, hierarchy: updateDev(prev.hierarchy, devId, patch) } : prev,
    );
  };

  const handleCommit = async () => {
    if (!projectId || !draft || !parked) return;
    try {
      const rev = await createDraft.mutateAsync({
        specProjectId: projectId,
        tree: draft as unknown as Record<string, unknown>,
        source: "foreign_ingest",
      });
      clearParked();
      navigate(`/specs?projectId=${projectId}&specId=${rev.spec_project_id}`);
    } catch (e) {
      // Error surfaces via mutation state
      console.error("[ingest-review] commit failed", e);
    }
  };

  const handleCancel = () => {
    clearParked();
    navigate(`/specs?projectId=${projectId ?? ""}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-base font-semibold">Confirm Imported Hierarchy</h2>
          <p className="text-xs text-muted-foreground">
            {unitCount} unit{unitCount === 1 ? "" : "s"} ·{" "}
            {equipment_moduleCount} assembl{equipment_moduleCount === 1 ? "y" : "ies"} ·{" "}
            {deviceCount} device{deviceCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={createDraft.isPending}
          >
            <Check className="h-4 w-4 mr-1" />
            {createDraft.isPending ? "Creating draft…" : "Create draft"}
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="p-3 border-b bg-amber-500/5">
          <div className="flex items-center gap-2 mb-1 text-amber-500 text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">
              {warnings.length} schema warning
              {warnings.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {warnings.slice(0, 6).map((w, i) => (
              <li key={i} className="font-mono">
                {w.path || "(root)"}: {w.message}
              </li>
            ))}
            {warnings.length > 6 && (
              <li>… {warnings.length - 6} more</li>
            )}
          </ul>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {draft.hierarchy.units.map((sub) => (
            <Card key={sub.unit_id} className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  Subsystem
                </Badge>
                <Input
                  className="h-7 text-sm flex-1"
                  value={sub.unit_name}
                  onChange={(e) =>
                    updateSubsystem(sub.unit_id, {
                      unit_name: e.target.value,
                    })
                  }
                />
              </div>
              <Separator />
              {sub.equipment_modules.map((asy) => (
                <div key={asy.equipment_module_id} className="pl-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Assembly
                    </Badge>
                    <Input
                      className="h-7 text-xs flex-1"
                      value={asy.equipment_module_name}
                      onChange={(e) =>
                        updateAssembly(asy.equipment_module_id, {
                          equipment_module_name: e.target.value,
                        })
                      }
                    />
                  </div>
                  {asy.control_modules.map((dev) => (
                    <div
                      key={dev.control_module_id}
                      className="pl-4 flex items-center gap-2"
                    >
                      <Badge variant="secondary" className="text-xs">
                        {dev.control_module_class}
                      </Badge>
                      <Input
                        className="h-7 text-xs flex-1 font-mono"
                        value={dev.control_module_name}
                        onChange={(e) =>
                          updateDevice(dev.control_module_id, {
                            control_module_name: e.target.value,
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        {dev.io_signals.length} IO
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny immutable helpers
// ---------------------------------------------------------------------------

function updateSub(h: Hierarchy, id: string, patch: Partial<UnitV2>): Hierarchy {
  return {
    units: h.units.map((s) =>
      s.unit_id === id ? { ...s, ...patch } : s,
    ),
  };
}

function updateAsy(h: Hierarchy, id: string, patch: Partial<EquipmentModuleV2>): Hierarchy {
  return {
    units: h.units.map((s) => ({
      ...s,
      equipment_modules: s.equipment_modules.map((a) =>
        a.equipment_module_id === id ? { ...a, ...patch } : a,
      ),
    })),
  };
}

function updateDev(h: Hierarchy, id: string, patch: Partial<ControlModuleV2>): Hierarchy {
  return {
    units: h.units.map((s) => ({
      ...s,
      equipment_modules: s.equipment_modules.map((a) => ({
        ...a,
        control_modules: a.control_modules.map((d) =>
          d.control_module_id === id ? { ...d, ...patch } : d,
        ),
      })),
    })),
  };
}
