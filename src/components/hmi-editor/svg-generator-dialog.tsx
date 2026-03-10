import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Sparkles,
  Check,
  RefreshCw,
  Palette,
  AlertCircle,
  ImagePlus,
  X,
} from "lucide-react";
import {
  SVG_GRAPHIC_CATEGORIES,
  SVG_GRAPHIC_STATES,
  SVG_GRAPHIC_STYLES,
  generateSvgGraphic,
  generateStateVariant,
  svgToDataUri,
} from "@/lib/hmi-svg-generator";
import type {
  SvgGraphicCategory,
  SvgGraphicStyle,
  GeneratedSvgGraphic,
} from "@/lib/hmi-svg-generator";
import { saveGeneratedGraphic } from "@/lib/hmi-generated-graphics-db";

interface SvgGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGraphicSaved: (graphic: GeneratedSvgGraphic) => void;
  /** Pre-fill for creating a variant of an existing graphic */
  variantOf?: GeneratedSvgGraphic | null;
  /** Editable prompt sections from Prompt Editor page */
  promptSections?: Record<string, string>;
}

type Phase = "describe" | "preview" | "states" | "done";

export function SvgGeneratorDialog({
  open,
  onOpenChange,
  onGraphicSaved,
  variantOf,
  promptSections,
}: SvgGeneratorDialogProps) {
  const [phase, setPhase] = useState<Phase>("describe");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SvgGraphicCategory>("motor");
  const [style, setStyle] = useState<SvgGraphicStyle>("isa101");
  const [customStyleInstructions, setCustomStyleInstructions] = useState("");
  const [referenceImage, setReferenceImage] = useState<{
    data: string;
    mediaType: string;
    fileName: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseSvg, setBaseSvg] = useState<string | null>(null);
  const [stateVariants, setStateVariants] = useState<Record<string, string>>(
    {},
  );
  const [generatingStates, setGeneratingStates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Apply variantOf defaults when dialog opens
  const prevVariantRef = useRef<string | null>(null);
  if (variantOf && phase === "describe" && prevVariantRef.current !== variantOf.id) {
    prevVariantRef.current = variantOf.id;
    setCategory(variantOf.category);
    setStyle(variantOf.style ?? "isa101");
    setName(`${variantOf.name} - Variant`);
    setDescription(variantOf.description);
  }

  const reset = useCallback(() => {
    setPhase("describe");
    setName("");
    setDescription("");
    setCategory("motor");
    setStyle("isa101");
    setCustomStyleInstructions("");
    setReferenceImage(null);
    setBaseSvg(null);
    setStateVariants({});
    setError(null);
    setLoading(false);
    setGeneratingStates(false);
    prevVariantRef.current = null;
  }, []);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) reset();
      onOpenChange(isOpen);
    },
    [onOpenChange, reset],
  );

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file (PNG, JPG, etc.)");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Image must be under 5MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setReferenceImage({
          data: base64,
          mediaType: file.type,
          fileName: file.name,
        });
        setError(null);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const svg = await generateSvgGraphic({
        description: description.trim(),
        category,
        style,
        customStyleInstructions:
          style === "custom" ? customStyleInstructions : undefined,
        referenceImage: referenceImage
          ? { data: referenceImage.data, mediaType: referenceImage.mediaType }
          : undefined,
        parentSvg: variantOf?.baseSvg,
        promptSections,
        signal: AbortSignal.timeout(60_000),
      });
      setBaseSvg(svg);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [
    description,
    category,
    style,
    customStyleInstructions,
    referenceImage,
    variantOf,
  ]);

  const handleRegenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const svg = await generateSvgGraphic({
        description: description.trim(),
        category,
        style,
        customStyleInstructions:
          style === "custom" ? customStyleInstructions : undefined,
        referenceImage: referenceImage
          ? { data: referenceImage.data, mediaType: referenceImage.mediaType }
          : undefined,
        parentSvg: variantOf?.baseSvg,
        promptSections,
        signal: AbortSignal.timeout(60_000),
      });
      setBaseSvg(svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setLoading(false);
    }
  }, [
    description,
    category,
    style,
    customStyleInstructions,
    referenceImage,
    variantOf,
  ]);

  const handleApproveAndGenerateStates = useCallback(async () => {
    if (!baseSvg) return;
    setGeneratingStates(true);
    setError(null);
    try {
      const states = SVG_GRAPHIC_STATES[category];
      const variants: Record<string, string> = {};
      for (const state of states) {
        variants[state] = generateStateVariant(baseSvg, state);
      }
      setStateVariants(variants);
      setPhase("states");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "State generation failed",
      );
    } finally {
      setGeneratingStates(false);
    }
  }, [baseSvg, category]);

  const handleSave = useCallback(async () => {
    if (!baseSvg || !name.trim()) return;
    setLoading(true);
    try {
      const graphic: GeneratedSvgGraphic = {
        id: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        category,
        description: description.trim(),
        style,
        baseSvg,
        stateVariants,
        previewUrl: svgToDataUri(baseSvg),
        createdAt: new Date().toISOString(),
        tags: [
          SVG_GRAPHIC_CATEGORIES[category].toLowerCase(),
          ...description
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3)
            .slice(0, 5),
        ],
        approved: true,
        variantOf: variantOf?.id,
      };
      await saveGeneratedGraphic(graphic);
      onGraphicSaved(graphic);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }, [
    baseSvg,
    name,
    category,
    description,
    style,
    stateVariants,
    variantOf,
    onGraphicSaved,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {variantOf
              ? `Create Variant of "${variantOf.name}"`
              : "Generate SVG Graphic"}
          </DialogTitle>
          <DialogDescription>
            {phase === "describe" &&
              (variantOf
                ? "Modify the description to create a variant"
                : "Describe the industrial graphic you need")}
            {phase === "preview" &&
              "Review the generated graphic before approving"}
            {phase === "states" &&
              "State variants generated — save to library"}
            {phase === "done" && "Graphic saved to your custom library"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Phase 1: Describe */}
        {phase === "describe" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. RollerConveyor_Short"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as SvgGraphicCategory)}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SVG_GRAPHIC_CATEGORIES).map(
                      ([key, label]) => (
                        <SelectItem key={key} value={key} className="text-xs">
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Style selector */}
            <div className="space-y-2">
              <Label className="text-xs">Style</Label>
              <Select
                value={style}
                onValueChange={(v) => setStyle(v as SvgGraphicStyle)}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SVG_GRAPHIC_STYLES).map(([key, label]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {style === "custom" && (
                <Textarea
                  value={customStyleInstructions}
                  onChange={(e) => setCustomStyleInstructions(e.target.value)}
                  placeholder="Describe your custom style... e.g. 'Retro blueprint style with white lines on blue background'"
                  className="text-xs"
                  rows={2}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. A short roller conveyor with 4 visible rollers, side rails, and a direction arrow"
                className="text-xs"
                rows={3}
              />
            </div>

            {/* Reference image upload */}
            <div className="space-y-2">
              <Label className="text-xs">Reference Image (optional)</Label>
              {referenceImage ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-xs">
                    {referenceImage.fileName}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => {
                      setReferenceImage(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Upload Reference Image
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <p className="text-[10px] text-muted-foreground">
                Upload a photo or sketch — the AI will recreate it as a clean
                SVG in the selected style
              </p>
            </div>

            <div className="text-xs text-muted-foreground">
              States that will be generated:{" "}
              {SVG_GRAPHIC_STATES[category].join(", ")}
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!name.trim() || !description.trim() || loading}
              className="w-full gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate Base Graphic
            </Button>
          </div>
        )}

        {/* Phase 2: Preview base graphic */}
        {phase === "preview" && baseSvg && (
          <div className="space-y-4">
            <div className="flex items-center justify-center rounded-lg border bg-slate-900 p-8">
              <div
                className="h-32 w-32"
                dangerouslySetInnerHTML={{ __html: baseSvg }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleRegenerate}
                disabled={loading}
                className="flex-1 gap-2"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Regenerate
              </Button>
              <Button
                onClick={handleApproveAndGenerateStates}
                disabled={generatingStates}
                className="flex-1 gap-2"
              >
                {generatingStates ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Palette className="h-4 w-4" />
                )}
                {generatingStates
                  ? "Generating States..."
                  : "Approve & Generate States"}
              </Button>
            </div>
          </div>
        )}

        {/* Phase 3: State variants */}
        {phase === "states" && (
          <div className="space-y-4">
            <ScrollArea className="h-64">
              <div className="grid grid-cols-4 gap-3 p-1">
                {Object.entries(stateVariants).map(([state, svg]) => (
                  <div key={state} className="space-y-1 text-center">
                    <div className="flex items-center justify-center rounded-md border bg-slate-900 p-3">
                      <div
                        className="h-16 w-16"
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {state}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Button
              onClick={handleSave}
              disabled={loading}
              className="w-full gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save to Custom Library
            </Button>
          </div>
        )}

        {/* Phase 4: Done */}
        {phase === "done" && (
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center">
              <div className="rounded-full bg-green-500/20 p-3">
                <Check className="h-6 w-6 text-green-500" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              &quot;{name}&quot; saved with{" "}
              {Object.keys(stateVariants).length} state variants.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} className="flex-1">
                Generate Another
              </Button>
              <Button onClick={() => handleClose(false)} className="flex-1">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
