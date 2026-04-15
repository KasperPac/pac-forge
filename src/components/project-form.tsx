import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectCreate, ProjectUpdate, CpuType } from "@/types";
import { PLC_BRANDS, CPU_TYPES } from "@/types";
import { useDesignProfiles } from "@/hooks/use-design-profiles";
import { useClients, useCreateClient } from "@/hooks/use-clients";
import { useDropboxConnection, useSuggestProjectNumber } from "@/hooks/use-dropbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
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
  const [clientId, setClientId] = useState(initialValues?.client_id ?? "none");
  const [clientName, setClientName] = useState(initialValues?.client_name ?? "");
  const [projectNumber, setProjectNumber] = useState(initialValues?.project_number ?? "");
  const [plcBrand] = useState(initialValues?.plc_brand ?? PLC_BRANDS.SIEMENS_TIA);
  const [tiaVersion, setTiaVersion] = useState(initialValues?.tia_version ?? "V20");
  const [cpuType, setCpuType] = useState<CpuType>(
    (initialValues?.cpu_type as CpuType) ?? CPU_TYPES["S7-1500"]
  );
  const [safetyLevel, setSafetyLevel] = useState(initialValues?.safety_level ?? "None");
  const [descriptionShort, setDescriptionShort] = useState(initialValues?.description_short ?? "");
  const [descriptionLong, setDescriptionLong] = useState(initialValues?.description_long ?? "");
  const [safetyNotes, setSafetyNotes] = useState(initialValues?.safety_notes ?? "");
  const [designProfileId, setDesignProfileId] = useState(initialValues?.design_profile_id ?? "none");
  const { data: profiles } = useDesignProfiles();
  const { data: clients } = useClients();
  const createClient = useCreateClient();

  // Inline new client creation
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");

  function handleCreateClient() {
    if (!newClientName.trim()) return;
    createClient.mutate({ name: newClientName.trim() }, {
      onSuccess: (created) => {
        setClientId(created.id);
        setClientName(created.name);
        setShowNewClient(false);
        setNewClientName("");
        // Trigger Dropbox suggestion for new client
        fetchSuggestion(created.name);
      },
    });
  }

  // Dropbox auto-suggest project number
  const { data: dropboxConn } = useDropboxConnection();
  const suggestNumber = useSuggestProjectNumber();
  const suggestNumberRef = useRef(suggestNumber);
  suggestNumberRef.current = suggestNumber;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnected = !!dropboxConn?.connected;

  const fetchSuggestion = useCallback(
    (name: string) => {
      if (!isConnected || !name.trim()) return;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        suggestNumberRef.current.mutate(name.trim());
      }, 600);
    },
    [isConnected]
  );

  // Fetch suggestion when client changes
  function handleClientChange(id: string) {
    setClientId(id);
    if (id !== "none") {
      const selected = clients?.find((c) => c.id === id);
      if (selected) {
        setClientName(selected.name);
        fetchSuggestion(selected.name);
      }
    } else {
      setClientName("");
    }
  }

  // Also fetch on mount if editing and client name exists
  useEffect(() => {
    if (mode === "create" && initialValues?.client_name) {
      fetchSuggestion(initialValues.client_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolvedClientName = clientId !== "none"
      ? (clients?.find((c) => c.id === clientId)?.name ?? clientName)
      : clientName;

    const data: ProjectCreate = {
      client_name: resolvedClientName,
      client_id: clientId !== "none" ? clientId : null,
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
      design_profile_id: designProfileId !== "none" ? designProfileId : null,
      functional_description: initialValues?.functional_description ?? null,
      functional_description_filename: initialValues?.functional_description_filename ?? null,
      description_short: descriptionShort || null,
      description_long: descriptionLong || null,
      dropbox_folder_path: initialValues?.dropbox_folder_path ?? null,
      github_repo_url: initialValues?.github_repo_url ?? null,
      github_repo_name: initialValues?.github_repo_name ?? null,
    };

    if (mode === "edit") {
      const updates: ProjectUpdate = {};
      if (resolvedClientName !== initialValues?.client_name) updates.client_name = resolvedClientName;
      const newClientId = clientId !== "none" ? clientId : null;
      if (newClientId !== (initialValues?.client_id ?? null)) updates.client_id = newClientId;
      if (projectNumber !== (initialValues?.project_number ?? "")) updates.project_number = projectNumber || null;
      if (tiaVersion !== initialValues?.tia_version) updates.tia_version = tiaVersion;
      if (cpuType !== initialValues?.cpu_type) updates.cpu_type = cpuType;
      if (safetyLevel !== initialValues?.safety_level) updates.safety_level = safetyLevel;
      if (safetyNotes !== initialValues?.safety_notes) updates.safety_notes = safetyNotes;
      const newProfileId = designProfileId !== "none" ? designProfileId : null;
      if (newProfileId !== (initialValues?.design_profile_id ?? null)) updates.design_profile_id = newProfileId;
      if (descriptionShort !== (initialValues?.description_short ?? "")) updates.description_short = descriptionShort || null;
      if (descriptionLong !== (initialValues?.description_long ?? "")) updates.description_long = descriptionLong || null;
      onSubmit(updates);
    } else {
      onSubmit(data);
    }
  }

  const hasClient = clientId !== "none";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="font-mono text-xs">Client</Label>
          {showNewClient ? (
            <div className="mt-1 flex gap-1.5">
              <Input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Client name"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateClient(); } }}
              />
              <Button type="button" size="sm" onClick={handleCreateClient} disabled={!newClientName.trim() || createClient.isPending}>
                {createClient.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewClient(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-1 flex gap-1.5">
              <Select value={clientId} onValueChange={handleClientChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.short_code ? ` (${c.short_code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => setShowNewClient(true)} title="New client">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div>
          <Label className="font-mono text-xs">Project Number</Label>
          <Input
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.target.value)}
            placeholder="e.g. CVL-2601"
            className="mt-1 font-mono"
          />
          {suggestNumber.isPending && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking Dropbox...
            </div>
          )}
          {suggestNumber.data?.suggested && !projectNumber && (
            <button
              type="button"
              className="mt-1"
              onClick={() => setProjectNumber(suggestNumber.data!.suggested!)}
            >
              <Badge
                variant="secondary"
                className="cursor-pointer font-mono text-xs hover:bg-accent"
              >
                Suggested: {suggestNumber.data.suggested}
              </Badge>
            </button>
          )}
          {suggestNumber.isError && (
            <p className="mt-1 text-xs text-destructive">
              {suggestNumber.error?.message ?? "Failed to check Dropbox"}
            </p>
          )}
          {suggestNumber.data && !suggestNumber.data.suggested && !suggestNumber.isPending && (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">
                {suggestNumber.data.clientExists === false
                  ? "Client folder not found in Dropbox"
                  : "No numbered folders found to suggest from"}
              </p>
              {suggestNumber.data.debug_path_checked && (
                <p className="text-[10px] text-muted-foreground/60 font-mono">
                  Checked: {suggestNumber.data.debug_path_checked}
                  {suggestNumber.data.debug_root_accessible === false && (
                    <> | Root error: {suggestNumber.data.debug_root_error}</>
                  )}
                  {(suggestNumber.data.debug_root_folders?.length ?? 0) > 0 && (
                    <> | Found in root: {suggestNumber.data.debug_root_folders!.join(", ")}</>
                  )}
                  {suggestNumber.data.debug_root_accessible && (suggestNumber.data.debug_root_folders?.length ?? 0) === 0 && (
                    <> | Root is empty or inaccessible</>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <Label className="font-mono text-xs">Short Description</Label>
          <Input
            value={descriptionShort}
            onChange={(e) => setDescriptionShort(e.target.value)}
            placeholder="e.g. Conveyor System Upgrade"
            className="mt-1"
          />
          {dropboxConn?.connected && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Used in Dropbox folder name
            </p>
          )}
        </div>

        <div>
          <Label className="font-mono text-xs">Long Description</Label>
          <Textarea
            value={descriptionLong}
            onChange={(e) => setDescriptionLong(e.target.value)}
            placeholder="Detailed job scope..."
            className="mt-1"
            rows={2}
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

        <div>
          <Label className="font-mono text-xs">Design Profile</Label>
          <Select value={designProfileId} onValueChange={setDesignProfileId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {profiles?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{p.client_name ? ` (${p.client_name})` : ""}
                </SelectItem>
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
        <Button type="submit" disabled={submitting || (!hasClient && !clientName)}>
          {submitting ? "..." : mode === "create" ? "Create Project" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
