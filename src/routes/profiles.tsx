import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Trash2, Clock, User, Loader2, SlidersHorizontal, FileText, FolderTree, Workflow, Blocks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useDesignProfiles,
  useCreateDesignProfile,
  useDeleteDesignProfile,
} from "@/hooks/use-design-profiles";
import type { DesignProfile, DesignProfileCreate } from "@/types";
import {
  PAC_STANDARD_GENERAL_RULES,
  PAC_STANDARD_FB_RULES,
  PAC_STANDARD_PROCESS_RULES,
  serializeGeneralRules,
  serializeFbRules,
  serializeProcessRules,
  DEFAULT_GENERAL_RULES,
  DEFAULT_FB_RULES,
  DEFAULT_PROCESS_RULES,
} from "@/lib/design-profile-schemas";
import { cn } from "@/lib/utils";

const EMPTY_FORM: Pick<DesignProfileCreate, "name" | "client_name" | "plc_brand"> = {
  name: "",
  client_name: null,
  plc_brand: "SIEMENS_TIA",
};

export default function ProfilesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [template, setTemplate] = useState<'blank' | 'pac_standard'>('blank');
  const navigate = useNavigate();

  const { data: profiles, isLoading } = useDesignProfiles();
  const createProfile = useCreateDesignProfile();
  const deleteProfile = useDeleteDesignProfile();

  function handleCreate() {
    const isPac = template === 'pac_standard';
    createProfile.mutate(
      {
        ...form,
        rules: "",
        general_rules: serializeGeneralRules(isPac ? PAC_STANDARD_GENERAL_RULES : DEFAULT_GENERAL_RULES),
        folder_rules: "",
        io_linking_rules: "",
        process_rules: serializeProcessRules(isPac ? PAC_STANDARD_PROCESS_RULES : DEFAULT_PROCESS_RULES),
        fb_rules: serializeFbRules(isPac ? PAC_STANDARD_FB_RULES : DEFAULT_FB_RULES),
        device_fb_language: "SCL" as const,
        device_call_fc_language: "SCL" as const,
        io_linking_language: "SCL" as const,
        process_code_language: "SCL" as const,
        conversion_fc_language: "SCL" as const,
        hmi_theme: "default",
        naming_prefix: "",
        db_naming_prefix: "",
      },
      {
        onSuccess: (profile) => {
          setDialogOpen(false);
          setForm(EMPTY_FORM);
          setTemplate('blank');
          navigate(`/profiles/${profile.id}`);
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">CONFIGURATION</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <SlidersHorizontal className="h-5 w-5" />
            Design Profiles
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-customer code generation rules &mdash; naming, folder structure,
            process patterns. Assign a profile to a project to enforce its rules.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)} className="mt-4 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Profile
        </Button>
      </div>

      <Separator />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : profiles?.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-12 text-center">
          <div className="font-mono text-sm text-muted-foreground">
            No profiles yet. Create one to define customer-specific code standards.
          </div>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {profiles?.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              onClick={() => navigate(`/profiles/${profile.id}`)}
              onDelete={(id) => deleteProfile.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Create dialog — minimal, just name + client */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">New Design Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Start from
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'blank' as const, label: 'Blank', desc: 'No pre-filled rules' },
                  { value: 'pac_standard' as const, label: 'Pac Standard', desc: 'Pre-filled with Pac Technologies standard layout' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTemplate(opt.value)}
                    className={cn(
                      'p-3 rounded border text-left transition-colors',
                      template === opt.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    <p className="font-mono text-xs font-medium">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-xs">Profile Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Coca-Cola Standard"
                className="font-mono text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-xs">Client Name (optional)</Label>
              <Input
                value={form.client_name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value || null }))}
                placeholder="e.g. Coca-Cola"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-xs">PLC Brand</Label>
              <Input value="Siemens TIA" disabled className="text-muted-foreground" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name.trim() || createProfile.isPending}>
              {createProfile.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileCard({
  profile,
  onClick,
  onDelete,
}: {
  profile: DesignProfile;
  onClick: () => void;
  onDelete: (id: string) => void;
}) {
  const generalRules = profile.general_rules || profile.rules || "";
  const hasGeneral = !!generalRules.trim();
  const hasFolders = !!profile.folder_rules?.trim();
  const hasProcess = (profile.process_rules?.length ?? 0) > 0;
  const hasFb = (profile.fb_rules?.length ?? 0) > 0;

  return (
    <Card
      className="group flex cursor-pointer flex-col p-4 transition-colors hover:bg-accent/30"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-mono text-sm font-semibold">{profile.name}</h3>
          {profile.client_name && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {profile.client_name}
            </div>
          )}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete profile?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{profile.name}&rdquo;. Projects using this profile will lose their design rules.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(profile.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="secondary" className="font-mono text-xs">{profile.plc_brand}</Badge>
      </div>

      {/* Rule category indicators */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {hasGeneral && (
          <div className="flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <FileText className="h-2.5 w-2.5" /> General
          </div>
        )}
        {hasFolders && (
          <div className="flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <FolderTree className="h-2.5 w-2.5" /> Folders
          </div>
        )}
        {hasProcess && (
          <div className="flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Workflow className="h-2.5 w-2.5" /> Process ({profile.process_rules.length})
          </div>
        )}
        {hasFb && (
          <div className="flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Blocks className="h-2.5 w-2.5" /> FB ({profile.fb_rules.length})
          </div>
        )}
        {!hasGeneral && !hasFolders && !hasProcess && !hasFb && (
          <div className="text-[10px] text-muted-foreground/60 italic">No rules configured</div>
        )}
      </div>

      <div className="mt-auto pt-2 flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {new Date(profile.updated_at).toLocaleDateString()}
      </div>
    </Card>
  );
}
