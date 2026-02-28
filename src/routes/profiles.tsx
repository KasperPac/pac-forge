import { useState } from "react";
import { Plus, Trash2, Pencil, Clock, User, Loader2, SlidersHorizontal, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  useUpdateDesignProfile,
  useDeleteDesignProfile,
} from "@/hooks/use-design-profiles";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { resolveSection } from "@/lib/prompt-defaults";
import { detectConflicts } from "@/lib/conflict-detector";
import type { KnowledgeConflict } from "@/lib/conflict-detector";
import type { DesignProfile, DesignProfileCreate } from "@/types";

const EMPTY_FORM: DesignProfileCreate = {
  name: "",
  client_name: null,
  plc_brand: "SIEMENS_TIA",
  rules: "",
};

const RULES_PLACEHOLDER = `# Naming Conventions
- FB prefix: FB_CK_
- FC prefix: FC_CK_
- DB prefix: DB_CK_
- Variable style: camelCase for locals, PascalCase for interface

# Comment Style
- Language: English
- Every FB must have a file header with: Author, Date, Description
- Section comments before each REGION

# Code Structure
- State machines: CASE with integer literals (0, 10, 20...)
- Error handling: dedicated #error BOOL + #errorCode INT
- HMI interface: separate VAR_OUTPUT section for HMI tags

# Custom Rules
- All timers must use TON with configurable PT as VAR_INPUT
- Maximum 100 lines per region`;

export default function ProfilesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<DesignProfile | null>(null);
  const [form, setForm] = useState<DesignProfileCreate>(EMPTY_FORM);
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);

  const { data: profiles, isLoading } = useDesignProfiles();
  const { data: promptSections } = useActivePromptSections();
  const createProfile = useCreateDesignProfile();
  const updateProfile = useUpdateDesignProfile();
  const deleteProfile = useDeleteDesignProfile();

  function openCreate() {
    setEditingProfile(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(profile: DesignProfile) {
    setEditingProfile(profile);
    setForm({
      name: profile.name,
      client_name: profile.client_name,
      plc_brand: profile.plc_brand,
      rules: profile.rules,
    });
    setDialogOpen(true);
  }

  function doSave() {
    if (editingProfile) {
      updateProfile.mutate(
        { id: editingProfile.id, updates: form },
        { onSuccess: () => { setDialogOpen(false); setConflicts([]); } },
      );
    } else {
      createProfile.mutate(form, {
        onSuccess: () => { setDialogOpen(false); setConflicts([]); },
      });
    }
  }

  function handleSave() {
    if (!form.rules.trim()) {
      doSave();
      return;
    }

    // Run conflict detection against platform rules
    const platformRulesText = resolveSection(promptSections, "shared", "platform_rules");
    const tempProfile = {
      id: editingProfile?.id ?? "new",
      name: form.name || "New Profile",
      client_name: form.client_name ?? null,
      plc_brand: form.plc_brand,
      rules: form.rules,
      created_at: "",
      updated_at: "",
      created_by: null,
    } as DesignProfile;

    const detected = detectConflicts({
      patterns: [],
      designProfile: tempProfile,
      fbTemplates: [],
      agentKnowledgeDocs: [],
      overrides: [],
      platformRulesText,
    });

    if (detected.length > 0) {
      setConflicts(detected);
      setConflictDialogOpen(true);
    } else {
      doSave();
    }
  }

  const isSaving = createProfile.isPending || updateProfile.isPending;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">CONFIGURATION</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <SlidersHorizontal className="h-5 w-5" />
            Design Profiles
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-customer code generation rules &mdash; naming, comments,
            structure. Assign a profile to a project to enforce its rules
            across all generation paths.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="mt-4 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Profile
        </Button>
      </div>

      <Separator />

      {/* Profile grid */}
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profiles?.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              onEdit={openEdit}
              onDelete={(id) => deleteProfile.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {editingProfile ? "Edit Profile" : "New Design Profile"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Name + Client */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="font-mono text-xs">Profile Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Coca-Cola Standard"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="font-mono text-xs">Client Name (optional)</Label>
                <Input
                  value={form.client_name ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, client_name: e.target.value || null }))
                  }
                  placeholder="e.g. Coca-Cola"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* PLC Brand (locked) */}
            <div className="space-y-1">
              <Label className="font-mono text-xs">PLC Brand</Label>
              <Input
                value="Siemens TIA"
                disabled
                className="text-muted-foreground"
              />
            </div>

            {/* Rules */}
            <div className="space-y-1">
              <Label className="font-mono text-xs">
                Code Rules
                <span className="ml-1 text-muted-foreground">(injected into all generation prompts)</span>
              </Label>
              <Textarea
                value={form.rules}
                onChange={(e) => setForm((f) => ({ ...f, rules: e.target.value }))}
                placeholder={RULES_PLACEHOLDER}
                className="min-h-[280px] resize-y font-mono text-xs leading-relaxed"
                rows={16}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || isSaving}
            >
              {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {editingProfile ? "Save Changes" : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict warning dialog */}
      <AlertDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Profile conflicts with Platform Rules
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Your design profile has {conflicts.length} rule{conflicts.length !== 1 ? "s" : ""} that
                  conflict with the default Platform Rules. <strong>Your profile will take priority</strong> for
                  naming and style — the agents will follow your profile, not the defaults.
                </p>
                <ScrollArea className="max-h-[240px]">
                  <div className="space-y-2 pr-3">
                    {conflicts.map((c) => (
                      <div key={c.id} className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="font-mono text-[9px]">
                            {c.category}
                          </Badge>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {Math.round(c.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="mt-1 text-xs">{c.description}</p>
                        <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="font-semibold text-muted-foreground">Profile says:</span>
                            <div className="mt-0.5 text-foreground">{c.sourceA.type === "DESIGN_PROFILE" ? c.sourceA.excerpt : c.sourceB.excerpt}</div>
                          </div>
                          <div>
                            <span className="font-semibold text-muted-foreground">Platform Rules say:</span>
                            <div className="mt-0.5 text-foreground">{c.sourceA.type === "PLATFORM_RULES" ? c.sourceA.excerpt : c.sourceB.excerpt}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConflicts([])}>
              Go Back
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConflictDialogOpen(false); doSave(); }}>
              Save Anyway — Profile Wins
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Profile Card ---

function ProfileCard({
  profile,
  onEdit,
  onDelete,
}: {
  profile: DesignProfile;
  onEdit: (p: DesignProfile) => void;
  onDelete: (id: string) => void;
}) {
  const previewLines = profile.rules.split("\n").slice(0, 6);
  const hasMore = profile.rules.split("\n").length > 6;

  return (
    <Card className="group flex flex-col p-4 transition-colors hover:bg-accent/30">
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
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onEdit(profile)}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete profile?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete "{profile.name}". Projects using this profile will lose their design rules.
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
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="secondary" className="font-mono text-xs">
          {profile.plc_brand}
        </Badge>
      </div>

      {/* Rules preview */}
      {profile.rules.trim() && (
        <div className="mt-2 overflow-hidden rounded border bg-black/20 px-2 py-1.5">
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
            {previewLines.join("\n")}
            {hasMore && "\n..."}
          </pre>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {new Date(profile.updated_at).toLocaleDateString()}
      </div>
    </Card>
  );
}
