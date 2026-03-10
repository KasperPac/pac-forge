import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Library } from "lucide-react";
import { useReferenceLibraryDocs } from "@/hooks/use-reference-library";
import { HMI_TEMPLATE_CATEGORIES } from "@/types/hmi-screen";
import type { HmiTemplateCategory } from "@/types/hmi-screen";

interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (meta: {
    name: string;
    category: HmiTemplateCategory;
    description: string;
    referenceDocIds: string[];
  }) => void;
  screenName: string;
}

export function SaveTemplateDialog({
  open,
  onOpenChange,
  onSave,
  screenName,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(screenName);
  const [category, setCategory] = useState<HmiTemplateCategory>("custom");
  const [description, setDescription] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  const { data: refDocs } = useReferenceLibraryDocs();

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setName(screenName);
      setCategory("custom");
      setDescription("");
      setSelectedDocIds([]);
    }
    onOpenChange(isOpen);
  };

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      category,
      description: description.trim(),
      referenceDocIds: selectedDocIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>
            Save the current screen layout as a reusable template for the HMI agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name" className="text-xs">
              Template Name
            </Label>
            <Input
              id="tmpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Motor Detail Faceplate"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tmpl-cat" className="text-xs">
              Category
            </Label>
            <select
              id="tmpl-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as HmiTemplateCategory)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {Object.entries(HMI_TEMPLATE_CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tmpl-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="tmpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe when this template should be used..."
              className="min-h-[60px] text-sm resize-none"
            />
          </div>

          {/* Reference doc linking */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Library className="h-3 w-3" />
              Link Reference Documents
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Linked docs will be pulled into the AI prompt when this template is used.
            </p>
            {selectedDocIds.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedDocIds.map((id) => {
                  const doc = refDocs?.find((d) => d.id === id);
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="gap-1 text-[10px] cursor-pointer hover:bg-destructive/10"
                      onClick={() => toggleDoc(id)}
                    >
                      {doc?.title ?? id.slice(0, 8)}
                      <X className="h-2.5 w-2.5" />
                    </Badge>
                  );
                })}
              </div>
            )}
            {refDocs && refDocs.length > 0 ? (
              <ScrollArea className="max-h-32 rounded border">
                <div className="p-1 space-y-0.5">
                  {refDocs.map((doc) => (
                    <button
                      key={doc.id}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent/30 ${
                        selectedDocIds.includes(doc.id) ? "bg-primary/10 border border-primary/30" : ""
                      }`}
                      onClick={() => toggleDoc(doc.id)}
                    >
                      <span className="flex-1 truncate">{doc.title}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {doc.section_count} sections
                      </span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-[10px] text-muted-foreground/50 italic">
                No reference docs uploaded yet
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim()}>
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
