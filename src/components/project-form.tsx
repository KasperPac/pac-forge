import { useState } from "react";
import type { ProjectCreate, ProjectUpdate, CpuType } from "@/types";
import { PLC_BRANDS, CPU_TYPES } from "@/types";
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

const TIA_VERSIONS = ["V17", "V18", "V19", "V20"] as const;
const SAFETY_LEVELS = ["None", "SIL 1", "SIL 2", "SIL 3"] as const;

interface ProjectFormProps {
  initialValues?: Partial<ProjectCreate>;
  onSubmit: (data: ProjectCreate | ProjectUpdate) => void;
  onCancel: () => void;
  submitting?: boolean;
  mode: "create" | "edit";
}

export function ProjectForm({
  initialValues,
  onSubmit,
  onCancel,
  submitting,
  mode,
}: ProjectFormProps) {
  const [clientName, setClientName] = useState(initialValues?.client_name ?? "");
  const [projectNumber, setProjectNumber] = useState(initialValues?.project_number ?? "");
  const [plcBrand] = useState(initialValues?.plc_brand ?? PLC_BRANDS.SIEMENS_TIA);
  const [tiaVersion, setTiaVersion] = useState(initialValues?.tia_version ?? "V17");
  const [cpuType, setCpuType] = useState<CpuType>(
    (initialValues?.cpu_type as CpuType) ?? CPU_TYPES["S7-1500"]
  );
  const [safetyLevel, setSafetyLevel] = useState(initialValues?.safety_level ?? "None");
  const [safetyNotes, setSafetyNotes] = useState(initialValues?.safety_notes ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: ProjectCreate = {
      client_name: clientName,
      project_number: projectNumber || null,
      plc_brand: plcBrand,
      tia_version: tiaVersion,
      cpu_type: cpuType,
      rack_slot_layout: initialValues?.rack_slot_layout ?? [],
      io_lists: initialValues?.io_lists ?? [],
      tag_db_definitions: initialValues?.tag_db_definitions ?? [],
      uploaded_docs: initialValues?.uploaded_docs ?? [],
      safety_level: safetyLevel,
      safety_notes: safetyNotes,
      revision_log: initialValues?.revision_log ?? [],
    };

    if (mode === "edit") {
      const updates: ProjectUpdate = {};
      if (clientName !== initialValues?.client_name) updates.client_name = clientName;
      if (projectNumber !== (initialValues?.project_number ?? "")) updates.project_number = projectNumber || null;
      if (tiaVersion !== initialValues?.tia_version) updates.tia_version = tiaVersion;
      if (cpuType !== initialValues?.cpu_type) updates.cpu_type = cpuType;
      if (safetyLevel !== initialValues?.safety_level) updates.safety_level = safetyLevel;
      if (safetyNotes !== initialValues?.safety_notes) updates.safety_notes = safetyNotes;
      onSubmit(updates);
    } else {
      onSubmit(data);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="font-mono text-xs">Client Name</Label>
          <Input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
            placeholder="e.g. ACME Industries"
            className="mt-1"
          />
        </div>

        <div>
          <Label className="font-mono text-xs">Project Number</Label>
          <Input
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.target.value)}
            placeholder="e.g. P-2024-0042"
            className="mt-1 font-mono"
          />
        </div>

        <div>
          <Label className="font-mono text-xs">PLC Brand</Label>
          <Input
            value="Siemens TIA"
            disabled
            className="mt-1 text-muted-foreground"
          />
        </div>

        <div>
          <Label className="font-mono text-xs">TIA Version</Label>
          <Select value={tiaVersion} onValueChange={setTiaVersion}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIA_VERSIONS.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="font-mono text-xs">CPU Type</Label>
          <Select value={cpuType} onValueChange={(v) => setCpuType(v as CpuType)}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(CPU_TYPES).map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="font-mono text-xs">Safety Level</Label>
          <Select value={safetyLevel} onValueChange={setSafetyLevel}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAFETY_LEVELS.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2">
          <Label className="font-mono text-xs">Safety Notes</Label>
          <Textarea
            value={safetyNotes}
            onChange={(e) => setSafetyNotes(e.target.value)}
            placeholder="Safety-related notes for this project..."
            className="mt-1"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !clientName}>
          {submitting ? "..." : mode === "create" ? "Create Project" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
