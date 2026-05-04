/**
 * PromoteToLibraryDialog — lets engineers save a custom assembly as a reusable
 * fb_templates entry (is_assembly=true, source=custom).
 *
 * Phase 5, Task 8.
 */
import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, BookMarked } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { usePromoteToLibrary } from "@/hooks/use-promote-to-library";
import type { FbTemplate } from "@/types/fb-template";
import type { AssemblyConfig, FdsAssemblySession } from "@/types/spec-builder";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assembly: AssemblyConfig;
  session: FdsAssemblySession;
  /** All existing templates — used for name uniqueness check. */
  existingTemplates: FbTemplate[];
  /** SpecProject.design_profile_id — for project-scoped option. */
  projectProfileId: string | null;
}

export function PromoteToLibraryDialog({
  open,
  onOpenChange,
  assembly,
  session,
  existingTemplates,
  projectProfileId,
}: Props) {
  const promote = usePromoteToLibrary();

  const [name, setName] = useState(assembly.assembly_name);
  const [category, setCategory] = useState("Assembly");
  const [description, setDescription] = useState(session.process_intent ?? "");
  const [scope, setScope] = useState<"project" | "global">("global");

  // Reset form when dialog opens for a fresh assembly
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName(assembly.assembly_name);
      setCategory("Assembly");
      setDescription(session.process_intent ?? "");
      setScope("global");
    }
    onOpenChange(nextOpen);
  };

  const nameConflict = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    return existingTemplates.some((t) => t.name.toLowerCase() === trimmed);
  }, [name, existingTemplates]);

  const canSave =
    name.trim().length > 0 &&
    !nameConflict &&
    !promote.isPending &&
    session.generated_scl_blocks.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await promote.mutateAsync({
        assemblyName: assembly.assembly_name,
        processIntent: session.process_intent ?? null,
        interfaceContract: session.interface_contract,
        generatedSclBlocks: session.generated_scl_blocks,
        name: name.trim(),
        category: category.trim() || "Assembly",
        description: description.trim(),
        scope,
        projectProfileId,
      });
      toast({
        title: "Saved as library template — available for future assemblies",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Promotion failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-primary" />
            Save as Library Template
          </DialogTitle>
          <DialogDescription>
            Package this assembly's interface contract and generated SCL blocks
            as a reusable template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="ptl-name" className="text-xs font-medium">
              Template name
            </Label>
            <Input
              id="ptl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lift Table LFT"
              className="h-8 text-sm"
            />
            {nameConflict && (
              <p className="text-[11px] text-destructive">
                A template with this name already exists.
              </p>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="ptl-cat" className="text-xs font-medium">
              Category
            </Label>
            <Input
              id="ptl-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Assembly"
              className="h-8 text-sm"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ptl-desc" className="text-xs font-medium">
              Description
            </Label>
            <Textarea
              id="ptl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the purpose of this assembly template…"
              className="text-sm resize-none h-20"
            />
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Scope</Label>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as "project" | "global")}
              className="space-y-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="global" id="ptl-scope-global" />
                <Label htmlFor="ptl-scope-global" className="text-xs font-normal cursor-pointer">
                  Global — available to all projects
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="project"
                  id="ptl-scope-project"
                  disabled={!projectProfileId}
                />
                <Label
                  htmlFor="ptl-scope-project"
                  className={cn("text-xs font-normal cursor-pointer", !projectProfileId && "text-muted-foreground")}
                >
                  Project-scoped — restricted to this project's design profile
                  {!projectProfileId && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(no design profile set)</span>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {session.generated_scl_blocks.length === 0 && (
            <p className="text-[11px] text-amber-400">
              No SCL blocks have been generated yet. Generate SCL before promoting.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={promote.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
          >
            {promote.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <BookMarked className="h-3.5 w-3.5 mr-1.5" />
            )}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
