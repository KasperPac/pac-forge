import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { DesignProfile } from "@/types/design-profile";

export interface ForgeProjectSetup {
  project_name: string;
  project_number: string;
  client_name: string;
  design_profile_id: string | null;
  code_language: "SCL" | "LAD" | "MIXED";
  process_code_language: "SCL" | "LAD" | "MIXED";
  tia_version: string;
  cpu_type: string;
  safety_level: string;
  safety_notes: string;
}

export interface ForgeProjectSetupProps {
  specAnalysis: SpecAnalysis | null;
  onComplete: (setup: ForgeProjectSetup) => void;
}

const TIA_VERSIONS = ["V17", "V18", "V19", "V20"] as const;
const CODE_LANGS = ["SCL", "LAD", "MIXED"] as const;

function profileLang(profile: DesignProfile | undefined, field: "code_language" | "process_code_language"): "SCL" | "LAD" | "MIXED" {
  const val = profile?.[field];
  if (val === "LAD" || val === "MIXED") return val;
  return "SCL";
}

export function ForgeProjectSetup({ specAnalysis, onComplete }: ForgeProjectSetupProps) {
  const { data: profiles = [] } = useDesignProfiles();

  const [form, setForm] = useState<ForgeProjectSetup>({
    project_name: specAnalysis?.project_name ?? "",
    project_number: "",
    client_name: "",
    design_profile_id: null,
    code_language: "SCL",
    process_code_language: "SCL",
    tia_version: "V18",
    cpu_type: specAnalysis?.plc_type ?? "S7-1500",
    safety_level: "",
    safety_notes: "",
  });

  // Pre-populate from spec analysis when it arrives
  useEffect(() => {
    if (specAnalysis) {
      setForm(prev => ({
        ...prev,
        project_name: prev.project_name || specAnalysis.project_name,
        cpu_type: prev.cpu_type || specAnalysis.plc_type,
      }));
    }
  }, [specAnalysis]);

  function set<K extends keyof ForgeProjectSetup>(key: K, value: ForgeProjectSetup[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function onProfileChange(profileId: string) {
    const profile = profiles.find(p => p.id === profileId);
    setForm(prev => ({
      ...prev,
      design_profile_id: profileId,
      code_language: profileLang(profile, "code_language"),
      process_code_language: profileLang(profile, "process_code_language"),
    }));
  }

  const canSubmit = form.project_name.trim().length > 0;

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Left column */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project_name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Project Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="project_name"
              value={form.project_name}
              onChange={e => set("project_name", e.target.value)}
              placeholder="e.g. Cathode Handling System"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project_number" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Project Number
            </Label>
            <Input
              id="project_number"
              value={form.project_number}
              onChange={e => set("project_number", e.target.value)}
              placeholder="e.g. PT-2026-042"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client_name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Client Name
            </Label>
            <Input
              id="client_name"
              value={form.client_name}
              onChange={e => set("client_name", e.target.value)}
              placeholder="e.g. Acme Industries"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Design Profile
            </Label>
            <Select
              value={form.design_profile_id ?? "__none__"}
              onValueChange={v => v === "__none__" ? set("design_profile_id", null) : onProfileChange(v)}
            >
              <SelectTrigger>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Code Language
              </Label>
              <Select
                value={form.code_language}
                onValueChange={v => set("code_language", v as "SCL" | "LAD" | "MIXED")}
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
                onValueChange={v => set("process_code_language", v as "SCL" | "LAD" | "MIXED")}
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
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                TIA Version
              </Label>
              <Select
                value={form.tia_version}
                onValueChange={v => set("tia_version", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIA_VERSIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                CPU Type
              </Label>
              <Select
                value={form.cpu_type}
                onValueChange={v => set("cpu_type", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(CPU_TYPES).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="safety_level" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Safety Level (optional)
            </Label>
            <Input
              id="safety_level"
              value={form.safety_level}
              onChange={e => set("safety_level", e.target.value)}
              placeholder="e.g. SIL 2, PLd"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="safety_notes" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Safety Notes
            </Label>
            <Textarea
              id="safety_notes"
              value={form.safety_notes}
              onChange={e => set("safety_notes", e.target.value)}
              placeholder="Additional safety requirements..."
              rows={3}
            />
          </div>
        </div>
      </div>

      <div className="mt-auto">
        <Button
          className="w-full"
          disabled={!canSubmit}
          onClick={() => onComplete(form)}
        >
          Save Project Setup
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
