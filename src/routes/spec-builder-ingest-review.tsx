/**
 * Engineer-confirm step for AI-ingested foreign specs.
 *
 * Reads the parked draft from `useIngestReviewStore`. The engineer can edit
 * subsystem / assembly / device names inline before committing. Commit calls
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
  AssemblyV2,
  DeviceV2,
  Hierarchy,
  SpecContractV2,
  SubsystemV2,
} from "@/types/spec-contract-v2";

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

  const subsystemCount = draft?.hierarchy.subsystems.length ?? 0;
  const assemblyCount = useMemo(
    () =>
      draft?.hierarchy.subsystems.reduce(
        (n, s) => n + s.assemblies.length,
        0,
      ) ?? 0,
    [draft],
  );
  const deviceCount = useMemo(
    () =>
      draft?.hierarchy.subsystems.reduce(
        (n, s) =>
          n + s.assemblies.reduce((m, a) => m + a.devices.length, 0),
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

  const updateSubsystem = (subId: string, patch: Partial<SubsystemV2>) => {
    setDraft((prev) =>
      prev ? { ...prev, hierarchy: updateSub(prev.hierarchy, subId, patch) } : prev,
    );
  };
  const updateAssembly = (asyId: string, patch: Partial<AssemblyV2>) => {
    setDraft((prev) =>
      prev ? { ...prev, hierarchy: updateAsy(prev.hierarchy, asyId, patch) } : prev,
    );
  };
  const updateDevice = (devId: string, patch: Partial<DeviceV2>) => {
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
            {subsystemCount} subsystem{subsystemCount === 1 ? "" : "s"} ·{" "}
            {assemblyCount} assembl{assemblyCount === 1 ? "y" : "ies"} ·{" "}
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
          {draft.hierarchy.subsystems.map((sub) => (
            <Card key={sub.subsystem_id} className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  Subsystem
                </Badge>
                <Input
                  className="h-7 text-sm flex-1"
                  value={sub.subsystem_name}
                  onChange={(e) =>
                    updateSubsystem(sub.subsystem_id, {
                      subsystem_name: e.target.value,
                    })
                  }
                />
              </div>
              <Separator />
              {sub.assemblies.map((asy) => (
                <div key={asy.assembly_id} className="pl-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Assembly
                    </Badge>
                    <Input
                      className="h-7 text-xs flex-1"
                      value={asy.assembly_name}
                      onChange={(e) =>
                        updateAssembly(asy.assembly_id, {
                          assembly_name: e.target.value,
                        })
                      }
                    />
                  </div>
                  {asy.devices.map((dev) => (
                    <div
                      key={dev.device_id}
                      className="pl-4 flex items-center gap-2"
                    >
                      <Badge variant="secondary" className="text-xs">
                        {dev.device_class}
                      </Badge>
                      <Input
                        className="h-7 text-xs flex-1 font-mono"
                        value={dev.device_name}
                        onChange={(e) =>
                          updateDevice(dev.device_id, {
                            device_name: e.target.value,
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

function updateSub(h: Hierarchy, id: string, patch: Partial<SubsystemV2>): Hierarchy {
  return {
    subsystems: h.subsystems.map((s) =>
      s.subsystem_id === id ? { ...s, ...patch } : s,
    ),
  };
}

function updateAsy(h: Hierarchy, id: string, patch: Partial<AssemblyV2>): Hierarchy {
  return {
    subsystems: h.subsystems.map((s) => ({
      ...s,
      assemblies: s.assemblies.map((a) =>
        a.assembly_id === id ? { ...a, ...patch } : a,
      ),
    })),
  };
}

function updateDev(h: Hierarchy, id: string, patch: Partial<DeviceV2>): Hierarchy {
  return {
    subsystems: h.subsystems.map((s) => ({
      ...s,
      assemblies: s.assemblies.map((a) => ({
        ...a,
        devices: a.devices.map((d) =>
          d.device_id === id ? { ...d, ...patch } : d,
        ),
      })),
    })),
  };
}
