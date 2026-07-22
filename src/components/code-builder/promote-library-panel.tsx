/**
 * G6-7 — "Promote to library" dialog for the Code Builder. Takes the selected
 * FB's artifact bundle (Code Builder edits overlaid), derives the fb_template
 * payload + interface contract + PackML states deterministically, and saves it
 * as an enabled library template — so future projects instantiate this proven
 * block instead of re-synthesizing it.
 */
import { useState } from "react";
import { Library, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deriveFbTemplate } from "@/lib/spec-builder/codegen/promote-template";
import { usePromoteFbTemplate } from "@/hooks/use-promote-fb-template";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { EmStateV2 } from "@/types/spec-contract-v2";

export function PromoteLibraryPanel({
  artifact,
  related,
  grain,
  states,
}: {
  artifact: CodeBuilderArtifactView;
  /** The owner-related bundle (falls back to the artifact itself when unowned). */
  related: CodeBuilderArtifactView[];
  grain: "em" | "cm";
  states?: EmStateV2[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [promotedAs, setPromotedAs] = useState<string | null>(null);
  const promote = usePromoteFbTemplate();

  const bundle = related.length > 0 ? related : [artifact];

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setName(artifact.owner_name ?? artifact.artifact_name);
      setCategory(grain === "em" ? "equipment_module" : "device");
      setWarnings([]);
      setError(null);
      setPromotedAs(null);
    }
  };

  const onPromote = async () => {
    setError(null);
    try {
      const derivation = deriveFbTemplate({
        grain,
        name: name.trim(),
        deviceCategory: category.trim(),
        blocks: bundle.map((b) => ({
          artifact_name: b.artifact_name,
          type: b.type,
          content: b.edited_content ?? b.generated_content,
        })),
        states: states?.map((s) => ({
          state_id: s.state_id,
          name: s.name,
          is_safe_state: s.is_safe_state,
        })),
        generatedAt: new Date().toISOString(),
      });
      setWarnings(derivation.warnings);
      const created = await promote.mutateAsync(derivation);
      setPromotedAs(created.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-full gap-1.5 text-[11px]">
          <Library className="h-3.5 w-3.5" />
          Promote to library
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Promote to FB Library</DialogTitle>
          <DialogDescription className="text-xs">
            Saves this {grain === "em" ? "equipment module" : "device"} block
            {grain === "em" ? " (FB + state type)" : ""} as a reusable library
            template. The interface contract{grain === "em" ? " and PackML states are" : " is"}{" "}
            derived automatically — future projects can instantiate it instead
            of regenerating.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="promote-name" className="text-xs">Template name</Label>
            <Input
              id="promote-name"
              className="h-7 text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="promote-category" className="text-xs">Device category</Label>
            <Input
              id="promote-category"
              className="h-7 text-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {bundle
              .filter((b) => b.type === "FB" || b.type === "UDT")
              .map((b) => b.artifact_name)
              .join(" · ")}
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {warnings.map((w) => (
          <p key={w} className="text-xs text-amber-600">{w}</p>
        ))}
        {promotedAs ? (
          <p className="text-xs font-medium text-green-700">
            Promoted as "{promotedAs}" — available to all projects from the FB Library.
          </p>
        ) : (
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={promote.isPending || !name.trim() || !category.trim()}
            onClick={onPromote}
          >
            {promote.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Promote
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
