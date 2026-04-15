/**
 * Structured Spec Editor — tree nav + inline editable content per section.
 *
 * Supports both V2 (industry-standard FDS, Sections 0–8) and legacy V1 section types.
 */
import { useState, useEffect, useMemo } from "react";
import {
  BookOpen,
  Boxes,
  Activity,
  Bell,
  Settings,
  ShieldCheck,
  CheckCircle2,
  Plus,
  Trash2,
  Save,
  Loader2,
  ChevronRight,
  FileText,
  Cpu,
  Compass,
  ListOrdered,
  Monitor,
  Link2,
  ClipboardCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpdateSpecSection } from "@/hooks/use-spec-projects";
import type { SpecSection, SpecProject, FunctionalDescriptionContent, DeviceStateEntry, StepEntry } from "@/types/spec-builder";
import { migrateOperatingStates } from "@/types/spec-builder";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tree node structure
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string;
  label: string;
  icon: typeof BookOpen;
  section: SpecSection;
  approved: boolean;
}

interface TreeGroup {
  label: string;
  icon: typeof BookOpen;
  nodes: TreeNode[];
}

function buildTree(sections: SpecSection[], spec: SpecProject): TreeGroup[] {
  const groups: TreeGroup[] = [];
  const subsystemName = (id: string | null) =>
    spec.confirmed_subsystems.find((s) => s.subsystem_id === id)?.subsystem_name ?? id ?? "?";
  const states = migrateOperatingStates(spec.confirmed_states);
  const stateName = (id: string | null) =>
    states.find((s) => s.state_id === id)?.state_name ?? id ?? "?";

  const hasV2 = sections.some((s) =>
    s.section_type === "document_control" ||
    s.section_type === "system_overview" ||
    s.section_type === "control_philosophy" ||
    s.section_type === "functional_description"
  );

  if (hasV2) {
    // V2 tree structure (industry-standard FDS)
    const node = (type: string) => sections.find((s) => s.section_type === type);

    const docControl = node("document_control");
    if (docControl) {
      groups.push({ label: "0. Document Control", icon: FileText, nodes: [
        { id: docControl.id, label: "Revision & References", icon: FileText, section: docControl, approved: docControl.approved },
      ]});
    }

    const sysOverview = node("system_overview");
    if (sysOverview) {
      groups.push({ label: "1. System Overview", icon: Cpu, nodes: [
        { id: sysOverview.id, label: "Hardware & IO Summary", icon: Cpu, section: sysOverview, approved: sysOverview.approved },
      ]});
    }

    const ctrlPhil = node("control_philosophy");
    if (ctrlPhil) {
      groups.push({ label: "2. Control Philosophy", icon: Compass, nodes: [
        { id: ctrlPhil.id, label: "States & Fault Philosophy", icon: Compass, section: ctrlPhil, approved: ctrlPhil.approved },
      ]});
    }

    // Section 3 — Equipment + Functional Descriptions grouped by subsystem
    const equipment = sections.filter((s) => s.section_type === "equipment_description");
    const funcDescs = sections.filter((s) => s.section_type === "functional_description");
    const assemblyName = (subsystemId: string | null, assemblyId: string | null) => {
      if (!assemblyId) return null;
      const sub = spec.confirmed_subsystems.find((s) => s.subsystem_id === subsystemId);
      return sub?.assemblies.find((a) => a.assembly_id === assemblyId)?.assembly_name ?? assemblyId;
    };
    if (equipment.length > 0 || funcDescs.length > 0) {
      const funcNodes: TreeNode[] = [];
      for (const eq of equipment) {
        funcNodes.push({
          id: eq.id,
          label: `${subsystemName(eq.subsystem_id)} — Equipment`,
          icon: Boxes,
          section: eq,
          approved: eq.approved,
        });
        // Add functional descriptions for this subsystem — sort by (state, assembly name)
        const subFuncs = funcDescs
          .filter((fd) => fd.subsystem_id === eq.subsystem_id)
          .slice()
          .sort((a, b) => {
            const stateA = stateName(a.state_name);
            const stateB = stateName(b.state_name);
            if (stateA !== stateB) return stateA.localeCompare(stateB);
            const aId = (a.content_json as { assembly_id?: string | null })?.assembly_id ?? null;
            const bId = (b.content_json as { assembly_id?: string | null })?.assembly_id ?? null;
            const aName = assemblyName(a.subsystem_id, aId) ?? "";
            const bName = assemblyName(b.subsystem_id, bId) ?? "";
            return aName.localeCompare(bName);
          });
        for (const fd of subFuncs) {
          const asmId = (fd.content_json as { assembly_id?: string | null })?.assembly_id ?? null;
          const asmName = assemblyName(fd.subsystem_id, asmId);
          const label = asmName
            ? `${subsystemName(fd.subsystem_id)} · ${asmName} — ${stateName(fd.state_name)}`
            : `${subsystemName(fd.subsystem_id)} — ${stateName(fd.state_name)}`;
          funcNodes.push({
            id: fd.id,
            label,
            icon: Activity,
            section: fd,
            approved: fd.approved,
          });
        }
      }
      groups.push({ label: "3. Functional Descriptions", icon: Activity, nodes: funcNodes });
    }

    const ioList = node("io_list");
    if (ioList) {
      groups.push({ label: "4. I/O List", icon: ListOrdered, nodes: [
        { id: ioList.id, label: "Complete I/O List", icon: ListOrdered, section: ioList, approved: ioList.approved },
      ]});
    }

    const alarmSpec = node("alarm_specification");
    if (alarmSpec) {
      groups.push({ label: "5. Alarm Specification", icon: Bell, nodes: [
        { id: alarmSpec.id, label: "Alarms & Cause/Effect", icon: Bell, section: alarmSpec, approved: alarmSpec.approved },
      ]});
    }

    const hmiSpec = node("hmi_specification");
    if (hmiSpec) {
      groups.push({ label: "6. HMI Specification", icon: Monitor, nodes: [
        { id: hmiSpec.id, label: "Screens & Access Levels", icon: Monitor, section: hmiSpec, approved: hmiSpec.approved },
      ]});
    }

    const interfaces = node("interfaces");
    if (interfaces) {
      groups.push({ label: "7. Interfaces", icon: Link2, nodes: [
        { id: interfaces.id, label: "Interface Specs", icon: Link2, section: interfaces, approved: interfaces.approved },
      ]});
    }

    const testingFat = node("testing_fat");
    if (testingFat) {
      groups.push({ label: "8. Testing / FAT", icon: ClipboardCheck, nodes: [
        { id: testingFat.id, label: "Test Procedures", icon: ClipboardCheck, section: testingFat, approved: testingFat.approved },
      ]});
    }
  } else {
    // V1 legacy tree structure
    const intro = sections.find((s) => s.section_type === "introduction");
    if (intro) {
      groups.push({ label: "Introduction", icon: BookOpen, nodes: [
        { id: intro.id, label: "Overview", icon: BookOpen, section: intro, approved: intro.approved },
      ]});
    }

    const equipment = sections.filter((s) => s.section_type === "equipment_description");
    if (equipment.length) {
      groups.push({ label: "Equipment", icon: Boxes, nodes: equipment.map((s) => ({
        id: s.id, label: subsystemName(s.subsystem_id), icon: Boxes, section: s, approved: s.approved,
      }))});
    }

    const legacyStates = sections.filter((s) => s.section_type === "functional_state");
    if (legacyStates.length) {
      groups.push({ label: "Functional States", icon: Activity, nodes: legacyStates.map((s) => ({
        id: s.id, label: `${subsystemName(s.subsystem_id)} — ${stateName(s.state_name)}`, icon: Activity, section: s, approved: s.approved,
      }))});
    }

    const alarms = sections.find((s) => s.section_type === "alarm_table");
    if (alarms) {
      groups.push({ label: "Alarms", icon: Bell, nodes: [
        { id: alarms.id, label: "Alarm Table", icon: Bell, section: alarms, approved: alarms.approved },
      ]});
    }

    const settings = sections.find((s) => s.section_type === "settings_table");
    if (settings) {
      groups.push({ label: "Settings", icon: Settings, nodes: [
        { id: settings.id, label: "Settings Table", icon: Settings, section: settings, approved: settings.approved },
      ]});
    }
  }

  // Audit report (common to both V1 and V2)
  const audit = sections.find((s) => s.section_type === "audit_report");
  if (audit) {
    groups.push({ label: "Audit", icon: ShieldCheck, nodes: [
      { id: audit.id, label: "Gap Audit Report", icon: ShieldCheck, section: audit, approved: audit.approved },
    ]});
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function SpecEditor({
  spec,
  sections,
  fullScreen = false,
}: {
  spec: SpecProject;
  sections: SpecSection[];
  fullScreen?: boolean;
}) {
  const tree = useMemo(() => buildTree(sections, spec), [sections, spec]);
  const [selectedId, setSelectedId] = useState<string | null>(
    tree[0]?.nodes[0]?.id ?? null
  );

  const selected = sections.find((s) => s.id === selectedId) ?? null;
  const totalCount = sections.length;
  const approvedCount = sections.filter((s) => s.approved).length;

  const outerCls = fullScreen
    ? "h-full w-full overflow-hidden border-0 rounded-none"
    : "overflow-hidden";
  const innerCls = fullScreen ? "flex h-full" : "flex h-[600px]";
  const sidebarCls = fullScreen
    ? "w-80 border-r flex flex-col shrink-0 bg-muted/30"
    : "w-64 border-r flex flex-col shrink-0 bg-muted/30";

  return (
    <Card className={outerCls}>
      <div className={innerCls}>
        {/* Tree nav */}
        <div className={sidebarCls}>
          <div className="p-2.5 border-b">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold">Sections</span>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                {approvedCount}/{totalCount} approved
              </Badge>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-2">
              {tree.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.label} className="space-y-0.5">
                    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                      <GroupIcon className="h-3 w-3" />
                      {group.label}
                    </div>
                    {group.nodes.map((node) => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedId(node.id)}
                        className={cn(
                          "w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-left transition-colors",
                          selectedId === node.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        )}
                      >
                        {node.approved ? (
                          <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate">{node.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Editor pane */}
        <div className="flex-1 overflow-auto">
          {selected ? (
            <SectionEditor section={selected} />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No section selected
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section editor dispatcher
// ---------------------------------------------------------------------------

function SectionEditor({ section }: { section: SpecSection }) {
  // Keep a local working copy per section — reset when section.id changes.
  const [content, setContent] = useState<Record<string, unknown>>(section.content_json);
  const [dirty, setDirty] = useState(false);
  const updateSection = useUpdateSpecSection();

  useEffect(() => {
    setContent(section.content_json);
    setDirty(false);
  }, [section.id, section.content_json]);

  const set = (patch: Record<string, unknown>) => {
    setContent((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = async () => {
    await updateSection.mutateAsync({ id: section.id, content_json: content });
    setDirty(false);
  };

  const handleApproveToggle = async () => {
    await updateSection.mutateAsync({ id: section.id, approved: !section.approved });
  };

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 sticky top-0 bg-background z-10 pb-3 border-b">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">
            {sectionTitle(section)}
          </h3>
          <p className="text-[11px] text-muted-foreground font-mono">
            {section.section_type} · {section.model_used}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {section.approved && (
            <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
              Approved
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleApproveToggle}
            disabled={updateSection.isPending}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            {section.approved ? "Unapprove" : "Approve"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || updateSection.isPending}>
            {updateSection.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Type-specific editor */}
      {/* V2 editors */}
      {section.section_type === "document_control" && <DocumentControlEditor content={content} set={set} />}
      {section.section_type === "system_overview" && <SystemOverviewEditor content={content} set={set} />}
      {section.section_type === "control_philosophy" && <ControlPhilosophyEditor content={content} set={set} />}
      {section.section_type === "functional_description" && <FunctionalDescriptionEditor content={content} set={set} />}
      {section.section_type === "io_list" && <IoListEditor content={content} set={set} />}
      {section.section_type === "alarm_specification" && <AlarmSpecEditor content={content} set={set} />}
      {section.section_type === "hmi_specification" && <HmiSpecEditor content={content} set={set} />}
      {section.section_type === "interfaces" && <PlaceholderEditor content={content} set={set} />}
      {section.section_type === "testing_fat" && <TestingFatEditor content={content} set={set} />}
      {/* V1 legacy editors */}
      {section.section_type === "introduction" && <IntroductionEditor content={content} set={set} />}
      {section.section_type === "equipment_description" && <EquipmentEditor content={content} set={set} />}
      {section.section_type === "functional_state" && <StateEditor content={content} set={set} />}
      {section.section_type === "alarm_table" && <AlarmEditor content={content} set={set} />}
      {section.section_type === "settings_table" && <SettingsEditor content={content} set={set} />}
      {/* Common */}
      {section.section_type === "audit_report" && <AuditViewer content={content} />}
    </div>
  );
}

function sectionTitle(section: SpecSection): string {
  switch (section.section_type) {
    // V2
    case "document_control": return "Document Control";
    case "system_overview": return "System Overview";
    case "control_philosophy": return "Control Philosophy";
    case "functional_description": return `Functional Description — ${section.subsystem_id ?? ""} / ${section.state_name ?? ""}`;
    case "io_list": return "I/O List";
    case "alarm_specification": return "Alarm Specification";
    case "hmi_specification": return "HMI Specification";
    case "interfaces": return "Interfaces";
    case "testing_fat": return "Testing / FAT";
    // V1 legacy
    case "introduction": return "Introduction";
    case "equipment_description": return `Equipment — ${section.subsystem_id ?? ""}`;
    case "functional_state": return `State — ${section.subsystem_id ?? ""} / ${section.state_name ?? ""}`;
    case "alarm_table": return "Alarm Table";
    case "settings_table": return "Settings Table";
    case "audit_report": return "Gap Audit Report";
    default: return section.section_type;
  }
}

// ---------------------------------------------------------------------------
// Type-specific editors
// ---------------------------------------------------------------------------

type EditorProps = {
  content: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
};

function IntroductionEditor({ content, set }: EditorProps) {
  return (
    <div className="space-y-4">
      <Field label="Overview">
        <Textarea
          rows={5}
          value={(content.overview as string) ?? ""}
          onChange={(e) => set({ overview: e.target.value })}
        />
      </Field>
      <Field label="Brief Description">
        <Textarea
          rows={6}
          value={(content.brief_description as string) ?? ""}
          onChange={(e) => set({ brief_description: e.target.value })}
        />
      </Field>
    </div>
  );
}

interface DeviceRow {
  device: string;
  tag: string;
  description: string;
}

function EquipmentEditor({ content, set }: EditorProps) {
  const table = (content.device_table as DeviceRow[]) ?? [];

  const updateRow = (i: number, patch: Partial<DeviceRow>) => {
    const next = table.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    set({ device_table: next });
  };

  const addRow = () =>
    set({ device_table: [...table, { device: "", tag: "", description: "" }] });

  const removeRow = (i: number) =>
    set({ device_table: table.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <Field label="Prose Description">
        <Textarea
          rows={5}
          value={(content.prose as string) ?? ""}
          onChange={(e) => set({ prose: e.target.value })}
        />
      </Field>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">Device Table</label>
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-3 w-3 mr-1" /> Add Row
          </Button>
        </div>
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-mono font-normal w-1/4">Device</th>
                <th className="p-2 text-left font-mono font-normal w-1/6">Tag</th>
                <th className="p-2 text-left font-mono font-normal">Description</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {table.map((row, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">
                    <Input
                      className="h-7 text-xs"
                      value={row.device}
                      onChange={(e) => updateRow(i, { device: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      className="h-7 text-xs font-mono"
                      value={row.tag}
                      onChange={(e) => updateRow(i, { tag: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      className="h-7 text-xs"
                      value={row.description}
                      onChange={(e) => updateRow(i, { description: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeRow(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
              {table.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-muted-foreground">
                    No devices. Click Add Row to start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StateEditor({ content, set }: EditorProps) {
  return (
    <Field label="State Narrative">
      <Textarea
        rows={10}
        value={(content.state_narrative as string) ?? ""}
        onChange={(e) => set({ state_narrative: e.target.value })}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// V2 editors
// ---------------------------------------------------------------------------

function DocumentControlEditor({ content, set }: EditorProps) {
  const acronyms = (content.acronyms as Array<{ term: string; definition: string }>) ?? [];
  const refDocs = (content.referenced_documents as Array<{ doc_code: string; title: string; revision: string }>) ?? [];

  return (
    <div className="space-y-5">
      <Field label="Referenced Documents">
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-mono font-normal">Code</th>
                <th className="p-2 text-left font-mono font-normal">Title</th>
                <th className="p-2 text-left font-mono font-normal">Rev</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {refDocs.map((d, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1"><Input className="h-7 text-xs font-mono" value={d.doc_code} onChange={(e) => {
                    const next = [...refDocs]; next[i] = { ...d, doc_code: e.target.value }; set({ referenced_documents: next });
                  }} /></td>
                  <td className="p-1"><Input className="h-7 text-xs" value={d.title} onChange={(e) => {
                    const next = [...refDocs]; next[i] = { ...d, title: e.target.value }; set({ referenced_documents: next });
                  }} /></td>
                  <td className="p-1"><Input className="h-7 text-xs font-mono w-20" value={d.revision} onChange={(e) => {
                    const next = [...refDocs]; next[i] = { ...d, revision: e.target.value }; set({ referenced_documents: next });
                  }} /></td>
                  <td className="p-1"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => set({ referenced_documents: refDocs.filter((_, idx) => idx !== i) })}><Trash2 className="h-3 w-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="outline" onClick={() => set({ referenced_documents: [...refDocs, { doc_code: "", title: "", revision: "" }] })}><Plus className="h-3 w-3 mr-1" /> Add</Button>
      </Field>
      <Field label="Acronyms & Definitions">
        <div className="border rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="p-2 text-left font-mono font-normal w-1/5">Term</th>
                <th className="p-2 text-left font-mono font-normal">Definition</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {acronyms.map((a, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1"><Input className="h-7 text-xs font-mono" value={a.term} onChange={(e) => {
                    const next = [...acronyms]; next[i] = { ...a, term: e.target.value }; set({ acronyms: next });
                  }} /></td>
                  <td className="p-1"><Input className="h-7 text-xs" value={a.definition} onChange={(e) => {
                    const next = [...acronyms]; next[i] = { ...a, definition: e.target.value }; set({ acronyms: next });
                  }} /></td>
                  <td className="p-1"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => set({ acronyms: acronyms.filter((_, idx) => idx !== i) })}><Trash2 className="h-3 w-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Field>
    </div>
  );
}

function SystemOverviewEditor({ content, set }: EditorProps) {
  return (
    <div className="space-y-4">
      <Field label="Hardware Description">
        <Textarea rows={4} value={(content.hardware_description as string) ?? ""} onChange={(e) => set({ hardware_description: e.target.value })} />
      </Field>
      <Field label="Scope Exclusions">
        <Textarea rows={3} value={(content.scope_exclusions as string) ?? ""} onChange={(e) => set({ scope_exclusions: e.target.value })} />
      </Field>
      <Field label="Safety Classification">
        <Textarea rows={2} value={(content.safety_classification as string) ?? ""} onChange={(e) => set({ safety_classification: e.target.value })} />
      </Field>
      {/* IO summary is read-only — computed deterministically */}
      {(content.io_summary as Array<Record<string, unknown>>)?.length > 0 && (
        <Field label="I/O Summary (computed)">
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-mono font-normal">Subsystem</th>
                  <th className="p-2 text-left font-mono font-normal">DI</th>
                  <th className="p-2 text-left font-mono font-normal">DO</th>
                  <th className="p-2 text-left font-mono font-normal">AI</th>
                  <th className="p-2 text-left font-mono font-normal">AO</th>
                </tr>
              </thead>
              <tbody>
                {(content.io_summary as Array<Record<string, unknown>>).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 text-xs">{String(r.subsystem_name)}</td>
                    <td className="p-2 text-xs font-mono">{String(r.di_count)}</td>
                    <td className="p-2 text-xs font-mono">{String(r.do_count)}</td>
                    <td className="p-2 text-xs font-mono">{String(r.ai_count)}</td>
                    <td className="p-2 text-xs font-mono">{String(r.ao_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Field>
      )}
    </div>
  );
}

function ControlPhilosophyEditor({ content, set }: EditorProps) {
  const principles = (content.design_principles as string[]) ?? [];

  return (
    <div className="space-y-4">
      <Field label="Mode Transitions">
        <Textarea rows={6} value={(content.mode_transitions as string) ?? ""} onChange={(e) => set({ mode_transitions: e.target.value })} />
      </Field>
      <Field label="Fault Philosophy">
        <Textarea rows={5} value={(content.fault_philosophy as string) ?? ""} onChange={(e) => set({ fault_philosophy: e.target.value })} />
      </Field>
      <Field label="Design Principles">
        <div className="space-y-1">
          {principles.map((p, i) => (
            <div key={i} className="flex gap-1">
              <Input className="h-7 text-xs" value={p} onChange={(e) => {
                const next = [...principles]; next[i] = e.target.value; set({ design_principles: next });
              }} />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => set({ design_principles: principles.filter((_, idx) => idx !== i) })}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ design_principles: [...principles, ""] })}><Plus className="h-3 w-3 mr-1" /> Add Principle</Button>
        </div>
      </Field>
    </div>
  );
}

function FunctionalDescriptionEditor({ content, set }: EditorProps) {
  const fdContent = content as unknown as FunctionalDescriptionContent;

  if (fdContent.pattern === "static") {
    // Pattern A — Device State Table
    const deviceStates = (fdContent.device_states ?? []) as DeviceStateEntry[];

    const updateRow = (i: number, patch: Partial<DeviceStateEntry>) => {
      const next = deviceStates.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      set({ device_states: next });
    };

    return (
      <div className="space-y-3">
        <Badge variant="outline" className="text-xs">Static State — Device State Table</Badge>
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-mono font-normal w-1/4">Tag</th>
                <th className="p-2 text-left font-mono font-normal">Description</th>
                <th className="p-2 text-left font-mono font-normal w-1/5">State</th>
              </tr>
            </thead>
            <tbody>
              {deviceStates.map((ds, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1"><Input className="h-7 text-xs font-mono" value={ds.tag} onChange={(e) => updateRow(i, { tag: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-7 text-xs" value={ds.description} onChange={(e) => updateRow(i, { description: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-7 text-xs font-mono font-bold" value={ds.state} onChange={(e) => updateRow(i, { state: e.target.value })} /></td>
                </tr>
              ))}
              {deviceStates.length === 0 && (
                <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No device states.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="outline" onClick={() => set({ device_states: [...deviceStates, { tag: "", description: "", state: "" }] })}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
      </div>
    );
  }

  // Pattern B — Step Table
  const permissives = (fdContent.permissives ?? []) as string[];
  const steps = (fdContent.steps ?? []) as StepEntry[];

  return (
    <div className="space-y-4">
      <Badge variant="outline" className="text-xs">Sequential State — Step Table</Badge>
      <Field label="Permissives">
        <div className="space-y-1">
          {permissives.map((p, i) => (
            <div key={i} className="flex gap-1">
              <Input className="h-7 text-xs font-mono" value={p} onChange={(e) => {
                const next = [...permissives]; next[i] = e.target.value; set({ permissives: next });
              }} />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => set({ permissives: permissives.filter((_, idx) => idx !== i) })}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ permissives: [...permissives, ""] })}><Plus className="h-3 w-3 mr-1" /> Add Permissive</Button>
        </div>
      </Field>
      <Field label="Steps">
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-mono font-normal w-12">Step</th>
                <th className="p-2 text-left font-mono font-normal">Action</th>
                <th className="p-2 text-left font-mono font-normal">Completion Criteria</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1"><Input className="h-7 text-xs font-mono w-12 text-center" value={String(s.step)} onChange={(e) => {
                    const next = [...steps]; next[i] = { ...s, step: parseInt(e.target.value) || i + 1 }; set({ steps: next });
                  }} /></td>
                  <td className="p-1"><Input className="h-7 text-xs" value={s.action} onChange={(e) => {
                    const next = [...steps]; next[i] = { ...s, action: e.target.value }; set({ steps: next });
                  }} /></td>
                  <td className="p-1"><Input className="h-7 text-xs" value={s.completion_criteria} onChange={(e) => {
                    const next = [...steps]; next[i] = { ...s, completion_criteria: e.target.value }; set({ steps: next });
                  }} /></td>
                  <td className="p-1"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => set({ steps: steps.filter((_, idx) => idx !== i) })}><Trash2 className="h-3 w-3" /></Button></td>
                </tr>
              ))}
              {steps.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No steps.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="outline" onClick={() => set({ steps: [...steps, { step: steps.length + 1, action: "", completion_criteria: "" }] })}><Plus className="h-3 w-3 mr-1" /> Add Step</Button>
      </Field>
      {fdContent.notes !== undefined && (
        <Field label="Notes">
          <Textarea rows={2} value={(fdContent.notes as string) ?? ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

function IoListEditor({ content, set }: EditorProps) {
  const entries = (content.io_entries as Array<Record<string, string>>) ?? [];

  const updateEntry = (i: number, field: string, value: string) => {
    const next = entries.map((e, idx) => idx === i ? { ...e, [field]: value } : e);
    set({ io_entries: next });
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="p-2 text-left font-mono font-normal">Tag</th>
            <th className="p-2 text-left font-mono font-normal">Type</th>
            <th className="p-2 text-left font-mono font-normal">Description</th>
            <th className="p-2 text-left font-mono font-normal">Signal</th>
            <th className="p-2 text-left font-mono font-normal">Address</th>
            <th className="p-2 text-left font-mono font-normal">Normal</th>
            <th className="p-2 text-left font-mono font-normal">Failsafe</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((io, i) => (
            <tr key={i} className="border-t">
              <td className="p-1"><Input className="h-7 text-xs font-mono" value={io.tag} onChange={(e) => updateEntry(i, "tag", e.target.value)} /></td>
              <td className="p-1"><Input className="h-7 text-xs" value={io.device_type} onChange={(e) => updateEntry(i, "device_type", e.target.value)} /></td>
              <td className="p-1"><Input className="h-7 text-xs" value={io.description} onChange={(e) => updateEntry(i, "description", e.target.value)} /></td>
              <td className="p-1"><Input className="h-7 text-xs font-mono w-12" value={io.signal_type} readOnly /></td>
              <td className="p-1"><Input className="h-7 text-xs font-mono w-16" value={io.io_address} readOnly /></td>
              <td className="p-1"><Input className="h-7 text-xs font-mono" value={io.normal_state} onChange={(e) => updateEntry(i, "normal_state", e.target.value)} /></td>
              <td className="p-1"><Input className="h-7 text-xs font-mono" value={io.failsafe_state} onChange={(e) => updateEntry(i, "failsafe_state", e.target.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlarmSpecEditor({ content, set }: EditorProps) {
  // Reuse the existing AlarmEditor for the alarm_tiers portion
  return (
    <div className="space-y-6">
      <AlarmEditor content={content} set={set} />
      {/* Cause & Effect Matrix is read-only in the editor for now */}
      {(content.cause_effect_matrix as Record<string, unknown>)?.causes && (
        <Field label="Cause & Effect Matrix">
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-mono font-normal">Cause</th>
                  <th className="p-2 text-left font-mono font-normal">Tag</th>
                  {((content.cause_effect_matrix as Record<string, unknown>).effects as string[] ?? []).map((eff, i) => (
                    <th key={i} className="p-2 text-center font-mono font-normal text-[10px]">{eff}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {((content.cause_effect_matrix as Record<string, unknown>).causes as Array<Record<string, unknown>> ?? []).map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 text-xs">{String(c.cause)}</td>
                    <td className="p-2 text-xs font-mono">{String(c.cause_tag)}</td>
                    {(c.effects as boolean[] ?? []).map((eff, j) => (
                      <td key={j} className="p-2 text-center text-xs">{eff ? "✓" : "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Field>
      )}
    </div>
  );
}

function HmiSpecEditor({ content, set }: EditorProps) {
  return (
    <div className="space-y-4">
      <Field label="Screen Hierarchy">
        <pre className="text-xs font-mono bg-muted/30 p-3 rounded-md overflow-auto max-h-[200px]">
          {JSON.stringify(content.screen_hierarchy, null, 2)}
        </pre>
      </Field>
      <Field label="Access Levels">
        <pre className="text-xs font-mono bg-muted/30 p-3 rounded-md overflow-auto max-h-[200px]">
          {JSON.stringify(content.access_levels, null, 2)}
        </pre>
      </Field>
      <Field label="Trending">
        <pre className="text-xs font-mono bg-muted/30 p-3 rounded-md overflow-auto max-h-[200px]">
          {JSON.stringify(content.trending, null, 2)}
        </pre>
      </Field>
    </div>
  );
}

function PlaceholderEditor({ content, set }: EditorProps) {
  return (
    <Field label="Notes">
      <Textarea rows={4} value={(content.note as string) ?? ""} onChange={(e) => set({ note: e.target.value })} />
    </Field>
  );
}

function TestingFatEditor({ content, set }: EditorProps) {
  const tests = (content.test_procedures as Array<Record<string, string>>) ?? [];

  const updateTest = (i: number, field: string, value: string) => {
    const next = tests.map((t, idx) => idx === i ? { ...t, [field]: value } : t);
    set({ test_procedures: next });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold">Test Procedures</label>
        <Button size="sm" variant="outline" onClick={() => set({ test_procedures: [...tests, { test_id: `T${String(tests.length + 1).padStart(3, "0")}`, description: "", section_ref: "", acceptance_criteria: "", result: "[PASS/FAIL]" }] })}><Plus className="h-3 w-3 mr-1" /> Add Test</Button>
      </div>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2 text-left font-mono font-normal w-16">ID</th>
              <th className="p-2 text-left font-mono font-normal">Description</th>
              <th className="p-2 text-left font-mono font-normal w-16">Ref</th>
              <th className="p-2 text-left font-mono font-normal">Acceptance Criteria</th>
              <th className="p-2 text-left font-mono font-normal w-24">Result</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {tests.map((t, i) => (
              <tr key={i} className="border-t">
                <td className="p-1"><Input className="h-7 text-xs font-mono" value={t.test_id} onChange={(e) => updateTest(i, "test_id", e.target.value)} /></td>
                <td className="p-1"><Input className="h-7 text-xs" value={t.description} onChange={(e) => updateTest(i, "description", e.target.value)} /></td>
                <td className="p-1"><Input className="h-7 text-xs font-mono" value={t.section_ref} onChange={(e) => updateTest(i, "section_ref", e.target.value)} /></td>
                <td className="p-1"><Input className="h-7 text-xs" value={t.acceptance_criteria} onChange={(e) => updateTest(i, "acceptance_criteria", e.target.value)} /></td>
                <td className="p-1"><Input className="h-7 text-xs font-mono" value={t.result} onChange={(e) => updateTest(i, "result", e.target.value)} /></td>
                <td className="p-1"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => set({ test_procedures: tests.filter((_, idx) => idx !== i) })}><Trash2 className="h-3 w-3" /></Button></td>
              </tr>
            ))}
            {tests.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No test procedures.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AlarmRow {
  tag: string;
  description: string;
  action: string;
  setpoint: string;
  delay: string;
}

interface AlarmTierGroup {
  tier_name: string;
  alarms: AlarmRow[];
}

function AlarmEditor({ content, set }: EditorProps) {
  const tiers = (content.alarm_tiers as AlarmTierGroup[]) ?? [];

  const updateAlarm = (tIdx: number, aIdx: number, patch: Partial<AlarmRow>) => {
    const next = tiers.map((t, ti) =>
      ti === tIdx
        ? { ...t, alarms: t.alarms.map((a, ai) => (ai === aIdx ? { ...a, ...patch } : a)) }
        : t
    );
    set({ alarm_tiers: next });
  };

  const addAlarm = (tIdx: number) => {
    const next = tiers.map((t, ti) =>
      ti === tIdx
        ? {
            ...t,
            alarms: [
              ...t.alarms,
              { tag: "", description: "", action: "", setpoint: "[ENGINEER TO SET]", delay: "[ENGINEER TO SET]" },
            ],
          }
        : t
    );
    set({ alarm_tiers: next });
  };

  const removeAlarm = (tIdx: number, aIdx: number) => {
    const next = tiers.map((t, ti) =>
      ti === tIdx ? { ...t, alarms: t.alarms.filter((_, ai) => ai !== aIdx) } : t
    );
    set({ alarm_tiers: next });
  };

  return (
    <div className="space-y-5">
      {tiers.map((tier, tIdx) => (
        <div key={tIdx} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold">{tier.tier_name}</h4>
            <Button size="sm" variant="outline" onClick={() => addAlarm(tIdx)}>
              <Plus className="h-3 w-3 mr-1" /> Add Alarm
            </Button>
          </div>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-mono font-normal">Tag</th>
                  <th className="p-2 text-left font-mono font-normal">Description</th>
                  <th className="p-2 text-left font-mono font-normal">Action</th>
                  <th className="p-2 text-left font-mono font-normal">Setpoint</th>
                  <th className="p-2 text-left font-mono font-normal">Delay</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {tier.alarms.map((a, aIdx) => (
                  <tr key={aIdx} className="border-t">
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs font-mono"
                        value={a.tag}
                        onChange={(e) => updateAlarm(tIdx, aIdx, { tag: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs"
                        value={a.description}
                        onChange={(e) => updateAlarm(tIdx, aIdx, { description: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs"
                        value={a.action}
                        onChange={(e) => updateAlarm(tIdx, aIdx, { action: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs font-mono"
                        value={a.setpoint}
                        onChange={(e) => updateAlarm(tIdx, aIdx, { setpoint: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs font-mono"
                        value={a.delay}
                        onChange={(e) => updateAlarm(tIdx, aIdx, { delay: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeAlarm(tIdx, aIdx)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {tier.alarms.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center text-muted-foreground">
                      No alarms in this tier.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ProcessSetting {
  parameter: string;
  default: string;
  unit: string;
  notes: string;
}

interface AlarmSetting {
  parameter: string;
  setpoint: string;
  unit: string;
  delay: string;
}

interface SubsystemSettings {
  subsystem_id: string;
  process_settings: ProcessSetting[];
  alarm_settings: AlarmSetting[];
}

function SettingsEditor({ content, set }: EditorProps) {
  const subsystems = (content.subsystems as SubsystemSettings[]) ?? [];

  const updateProcess = (sIdx: number, pIdx: number, patch: Partial<ProcessSetting>) => {
    const next = subsystems.map((s, si) =>
      si === sIdx
        ? { ...s, process_settings: s.process_settings.map((p, pi) => (pi === pIdx ? { ...p, ...patch } : p)) }
        : s
    );
    set({ subsystems: next });
  };

  const updateAlarm = (sIdx: number, aIdx: number, patch: Partial<AlarmSetting>) => {
    const next = subsystems.map((s, si) =>
      si === sIdx
        ? { ...s, alarm_settings: s.alarm_settings.map((a, ai) => (ai === aIdx ? { ...a, ...patch } : a)) }
        : s
    );
    set({ subsystems: next });
  };

  return (
    <div className="space-y-6">
      {subsystems.map((sub, sIdx) => (
        <div key={sIdx} className="space-y-3">
          <h4 className="text-xs font-semibold font-mono">{sub.subsystem_id}</h4>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">
              Process Settings
            </label>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-mono font-normal">Parameter</th>
                    <th className="p-2 text-left font-mono font-normal">Default</th>
                    <th className="p-2 text-left font-mono font-normal">Unit</th>
                    <th className="p-2 text-left font-mono font-normal">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {sub.process_settings.map((p, pIdx) => (
                    <tr key={pIdx} className="border-t">
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs"
                          value={p.parameter}
                          onChange={(e) => updateProcess(sIdx, pIdx, { parameter: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs font-mono"
                          value={p.default}
                          onChange={(e) => updateProcess(sIdx, pIdx, { default: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs"
                          value={p.unit}
                          onChange={(e) => updateProcess(sIdx, pIdx, { unit: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs"
                          value={p.notes}
                          onChange={(e) => updateProcess(sIdx, pIdx, { notes: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">
              Alarm Settings
            </label>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-mono font-normal">Parameter</th>
                    <th className="p-2 text-left font-mono font-normal">Setpoint</th>
                    <th className="p-2 text-left font-mono font-normal">Unit</th>
                    <th className="p-2 text-left font-mono font-normal">Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {sub.alarm_settings.map((a, aIdx) => (
                    <tr key={aIdx} className="border-t">
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs"
                          value={a.parameter}
                          onChange={(e) => updateAlarm(sIdx, aIdx, { parameter: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs font-mono"
                          value={a.setpoint}
                          onChange={(e) => updateAlarm(sIdx, aIdx, { setpoint: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs"
                          value={a.unit}
                          onChange={(e) => updateAlarm(sIdx, aIdx, { unit: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-7 text-xs font-mono"
                          value={a.delay}
                          onChange={(e) => updateAlarm(sIdx, aIdx, { delay: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {sIdx < subsystems.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  );
}

function AuditViewer({ content }: { content: Record<string, unknown> }) {
  const status = content.overall_status as string;
  const missingTags = (content.missing_tags as string[]) ?? [];
  const missingStates = (content.missing_states as Array<{ subsystem: string; state: string }>) ?? [];
  const missingAlarms = (content.missing_alarms as string[]) ?? [];
  const placeholders = (content.placeholders as Array<{ text: string; location: string }>) ?? [];
  const inconsistencies = (content.tag_inconsistencies as string[]) ?? [];
  const interlocks = (content.interlock_gaps as string[]) ?? [];
  const summary = content.summary as string;

  const statusColor =
    status === "pass" ? "text-green-400" : status === "fail" ? "text-red-400" : "text-amber-400";

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn("text-xs", statusColor)}>
          {status?.toUpperCase() ?? "UNKNOWN"}
        </Badge>
      </div>
      {summary && <p className="text-muted-foreground">{summary}</p>}

      <AuditList title="Missing Tags" items={missingTags} />
      <AuditList
        title="Missing States"
        items={missingStates.map((s) => `${s.subsystem} — ${s.state}`)}
      />
      <AuditList title="Missing Alarms" items={missingAlarms} />
      <AuditList
        title="Placeholders"
        items={placeholders.map((p) => `${p.location}: ${p.text}`)}
      />
      <AuditList title="Tag Inconsistencies" items={inconsistencies} />
      <AuditList title="Interlock Gaps" items={interlocks} />
    </div>
  );
}

function AuditList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold">{title} ({items.length})</h4>
      <ul className="space-y-0.5 text-xs text-muted-foreground font-mono pl-3">
        {items.map((item, i) => (
          <li key={i}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field wrapper
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold">{label}</label>
      {children}
    </div>
  );
}
