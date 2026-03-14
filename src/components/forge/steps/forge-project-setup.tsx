import { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDesignProfiles } from "@/hooks/use-design-profiles";
import { CPU_TYPES } from "@/types/project";
import type { SpecAnalysis } from "@/types/forge";
import type { Project } from "@/types/project";

export interface ForgeProjectSetup {
  project_name: string;
  project_number: string;
  client_name: string;
  design_profile_id: string | null;
  device_fb_language: "SCL" | "LAD";
  io_linking_language: "SCL" | "LAD";
  process_code_language: "SCL" | "LAD";
  tia_version: string;
  cpu_type: string;
  safety_level: string;
  safety_notes: string;
  tia_project_path: string | null;
}

export interface ForgeProjectSetupProps {
  specAnalysis: SpecAnalysis | null;
  project: Project | null;
  onComplete: (setup: ForgeProjectSetup) => void;
  /** Called whenever the form's submit-readiness changes — lets parent enable/disable its own save button. */
  onCanSubmitChange?: (canSubmit: boolean) => void;
  /** Previously-saved language choices from the session (used to restore form when navigating back) */
  initialDeviceFbLanguage?: "SCL" | "LAD";
  initialIoLinkingLanguage?: "SCL" | "LAD";
  initialProcessCodeLanguage?: "SCL" | "LAD";
}

/** Handle exposed via ref — lets the parent footer nav trigger save without duplicating buttons. */
export interface ForgeProjectSetupHandle {
  submit: () => void;
  canSubmit: boolean;
}

const TIA_VERSIONS = ["V17", "V18", "V19", "V20"] as const;
const CODE_LANGS = ["SCL", "LAD"] as const;


/** Pad PLC number to 2 digits: 1 → "01", 12 → "12" */
function padPlcNum(n: number): string {
  return String(Math.max(1, n)).padStart(2, "0");
}

export const ForgeProjectSetup = forwardRef<ForgeProjectSetupHandle, ForgeProjectSetupProps>(function ForgeProjectSetup({ specAnalysis, project, onComplete, onCanSubmitChange, initialDeviceFbLanguage, initialIoLinkingLanguage, initialProcessCodeLanguage }, ref) {
  const { data: profiles = [] } = useDesignProfiles();

  const [form, setForm] = useState<ForgeProjectSetup>({
    project_name: project?.description_short ?? specAnalysis?.project_name ?? "",
    project_number: project?.project_number ?? "",
    client_name: project?.client_name ?? "",
    design_profile_id: project?.design_profile_id ?? null,
    device_fb_language: initialDeviceFbLanguage ?? "SCL",
    io_linking_language: initialIoLinkingLanguage ?? "SCL",
    process_code_language: initialProcessCodeLanguage ?? "SCL",
    tia_version: project?.tia_version ?? "V18",
    cpu_type: project?.cpu_type ?? specAnalysis?.plc_type ?? "S7-1500",
    safety_level: project?.safety_level ?? "",
    safety_notes: project?.safety_notes ?? "",
    tia_project_path: null,
  });

  // PLC sequence number within the job (01, 02, 03…)
  const [plcNumber, setPlcNumber] = useState(1);

  // Derived TIA project path from Dropbox job folder
  const derivedTiaPath = useMemo(() => {
    const base = project?.dropbox_folder_path;
    const name = form.project_name.trim();
    if (!base || !name) return null;
    return `${base}\\50 PLC\\${padPlcNum(plcNumber)} ${name}`;
  }, [project?.dropbox_folder_path, form.project_name, plcNumber]);

  // Pre-populate from spec analysis when it arrives (only fields not already from project)
  useEffect(() => {
    if (specAnalysis) {
      setForm(prev => ({
        ...prev,
        project_name: prev.project_name || specAnalysis.project_name || "",
        cpu_type: prev.cpu_type || specAnalysis.plc_type || "S7-1500",
      }));
    }
  }, [specAnalysis]);

  function set<K extends keyof ForgeProjectSetup>(key: K, value: ForgeProjectSetup[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function onProfileChange(profileId: string) {
    setForm(prev => ({
      ...prev,
      design_profile_id: profileId,
      // Language settings are session-level overrides — do not reset them when switching profiles.
      // The user sets language independently via the dropdowns below.
    }));
  }

  const canSubmit = (form.project_name ?? "").trim().length > 0;

  useImperativeHandle(ref, () => ({
    submit: () => onComplete({ ...form, tia_project_path: derivedTiaPath ?? form.tia_project_path }),
    canSubmit,
  }), [form, derivedTiaPath, canSubmit, onComplete]);

  useEffect(() => {
    onCanSubmitChange?.(canSubmit);
  }, [canSubmit, onCanSubmitChange]);

  // Fields locked because they come from the linked project
  const fromProject = !!project;

  return (
    <div className="flex h-full flex-col gap-5">
      {fromProject && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Fields marked <span className="text-primary">from project</span> are pre-filled from the linked project and locked here. Edit them on the project page.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Left column */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="project_name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Project Name <span className="text-destructive">*</span>
              </Label>
              {fromProject && project.description_short && (
                <span className="font-mono text-[10px] text-primary/70">from project</span>
              )}
            </div>
            <Input
              id="project_name"
              value={form.project_name}
              onChange={e => set("project_name", e.target.value)}
              placeholder="e.g. Cathode Handling System"
              disabled={fromProject && !!project.description_short}
              className={fromProject && project.description_short ? "opacity-60" : ""}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="project_number" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Project Number
              </Label>
              {fromProject && project.project_number && (
                <span className="font-mono text-[10px] text-primary/70">from project</span>
              )}
            </div>
            <Input
              id="project_number"
              value={form.project_number}
              onChange={e => set("project_number", e.target.value)}
              placeholder="e.g. PT-2026-042"
              className={`font-mono${fromProject && project.project_number ? " opacity-60" : ""}`}
              disabled={fromProject && !!project.project_number}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="client_name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Client Name
              </Label>
              {fromProject && (
                <span className="font-mono text-[10px] text-primary/70">from project</span>
              )}
            </div>
            <Input
              id="client_name"
              value={form.client_name}
              onChange={e => set("client_name", e.target.value)}
              placeholder="e.g. Acme Industries"
              disabled={fromProject}
              className={fromProject ? "opacity-60" : ""}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Design Profile
              </Label>
              {fromProject && project.design_profile_id && (
                <span className="font-mono text-[10px] text-primary/70">from project</span>
              )}
            </div>
            <Select
              value={form.design_profile_id ?? "__none__"}
              onValueChange={v => v === "__none__" ? set("design_profile_id", null) : onProfileChange(v)}
              disabled={fromProject && !!project.design_profile_id}
            >
              <SelectTrigger className={fromProject && project.design_profile_id ? "opacity-60" : ""}>
                <SelectValue placeholder="Default (no profile)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Default (no profile)</SelectItem>
                {profiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Device FB Lang
              </Label>
              <Select
                value={form.device_fb_language}
                onValueChange={v => set("device_fb_language", v as "SCL" | "LAD")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CODE_LANGS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                IO Linking Lang
              </Label>
              <Select
                value={form.io_linking_language}
                onValueChange={v => set("io_linking_language", v as "SCL" | "LAD")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CODE_LANGS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Process Lang
              </Label>
              <Select
                value={form.process_code_language}
                onValueChange={v => set("process_code_language", v as "SCL" | "LAD")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CODE_LANGS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  TIA Version
                </Label>
                {fromProject && (
                  <span className="font-mono text-[10px] text-primary/70">from project</span>
                )}
              </div>
              <Select
                value={form.tia_version}
                onValueChange={v => set("tia_version", v)}
                disabled={fromProject}
              >
                <SelectTrigger className={fromProject ? "opacity-60" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIA_VERSIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  CPU Type
                </Label>
                {fromProject && (
                  <span className="font-mono text-[10px] text-primary/70">from project</span>
                )}
              </div>
              <Select
                value={form.cpu_type}
                onValueChange={v => set("cpu_type", v)}
                disabled={fromProject}
              >
                <SelectTrigger className={fromProject ? "opacity-60" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(CPU_TYPES).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="safety_level" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Safety Level (optional)
              </Label>
              {fromProject && project.safety_level && (
                <span className="font-mono text-[10px] text-primary/70">from project</span>
              )}
            </div>
            <Input
              id="safety_level"
              value={form.safety_level}
              onChange={e => set("safety_level", e.target.value)}
              placeholder="e.g. SIL 2, PLd"
              disabled={fromProject && !!project.safety_level}
              className={fromProject && project.safety_level ? "opacity-60" : ""}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="safety_notes" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Safety Notes
              </Label>
              {fromProject && project.safety_notes && (
                <span className="font-mono text-[10px] text-primary/70">from project</span>
              )}
            </div>
            <Textarea
              id="safety_notes"
              value={form.safety_notes}
              onChange={e => set("safety_notes", e.target.value)}
              placeholder="Additional safety requirements..."
              rows={3}
              disabled={fromProject && !!project.safety_notes}
              className={fromProject && project.safety_notes ? "opacity-60" : ""}
            />
          </div>
        </div>
      </div>

      {/* TIA Project Location */}
      <div className="rounded-md border border-border/60 bg-background/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            TIA Project Location
          </span>
        </div>

        {project?.dropbox_folder_path ? (
          <>
            <div className="flex items-end gap-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  PLC No.
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={plcNumber}
                  onChange={e => setPlcNumber(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-9 w-16 font-mono text-sm"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Derived Path
                </Label>
                <div className="flex h-9 items-center rounded-md border border-border/50 bg-muted/20 px-3 font-mono text-[11px] text-muted-foreground overflow-x-auto whitespace-nowrap">
                  {derivedTiaPath ?? <span className="italic">Enter project name to derive path</span>}
                </div>
              </div>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground/60">
              Path: <span className="text-muted-foreground">{project.dropbox_folder_path}</span>\50 PLC\{padPlcNum(plcNumber)} {"{Project Name}"}
            </p>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="tia_path" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              TIA Project Path (manual — no Dropbox folder linked)
            </Label>
            <Input
              id="tia_path"
              value={form.tia_project_path ?? ""}
              onChange={e => set("tia_project_path", e.target.value || null)}
              placeholder="C:\...\50 PLC\01 Project Name"
              className="font-mono text-xs"
            />
          </div>
        )}
      </div>

    </div>
  );
});
