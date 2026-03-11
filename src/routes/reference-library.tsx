import { useState, useRef, useCallback } from "react";
import {
  Library,
  Upload,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  Tag,
  AlertCircle,
  Eye,
  BookOpen,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
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
  useReferenceLibraryDocs,
  useReferenceLibrarySections,
  useUploadReferenceDoc,
  useDeleteReferenceDoc,
} from "@/hooks/use-reference-library";
import { useVisionPdfUpload } from "@/hooks/use-vision-pdf-upload";
import { readFileAsText, extractPdfServerSide, getFileType } from "@/lib/document-reader";
import { getPdfPageCount } from "@/lib/document-extractor";
import { cn } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = ".md,.txt,.docx,.scl,.pdf";

function SectionsList({ docId }: { docId: string }) {
  const { data: sections, isLoading } = useReferenceLibrarySections(docId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Loading sections...
      </div>
    );
  }

  if (!sections || sections.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No sections found.
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-3 pb-3">
      {sections.map((s) => {
        const isOpen = expanded.has(s.id);
        return (
          <div key={s.id} className="rounded border">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/30"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  return next;
                })
              }
            >
              {isOpen ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {s.heading}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {s.char_count.toLocaleString()} chars
              </span>
            </button>
            {isOpen && (
              <div className="border-t px-3 py-2">
                {s.topic_tags.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {s.topic_tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="h-4 gap-0.5 px-1.5 font-mono text-[9px]"
                      >
                        <Tag className="h-2 w-2" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="max-h-40 overflow-y-auto rounded bg-muted/50 p-2">
                  <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed">
                    {s.content}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ReferenceLibraryPage() {
  const { data: docs, isLoading } = useReferenceLibraryDocs();
  const uploadDoc = useUploadReferenceDoc();
  const visionUpload = useVisionPdfUpload();
  const deleteDoc = useDeleteReferenceDoc();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const visionFileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [visionProgress, setVisionProgress] = useState<{
    current: number;
    total: number;
    status: string;
  } | null>(null);
  const [visionConfig, setVisionConfig] = useState<{
    file: File;
    pageCount: number;
    startPage: number;
    endPage: number;
  } | null>(null);

  const handleFileUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      setUploading(true);

      try {
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        const content = isPdf
          ? await extractPdfServerSide(file)
          : await readFileAsText(file);
        if (!content.trim()) {
          setUploadError("The document appears to be empty.");
          setUploading(false);
          return;
        }

        const fileType = getFileType(file.name);
        const title = file.name.replace(/\.[^.]+$/, "");

        await uploadDoc.mutateAsync({
          title,
          content,
          sourceFilename: file.name,
          fileType,
        });
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to upload document",
        );
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [uploadDoc],
  );

  const handleVisionFileSelect = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Vision upload only supports PDF files.");
      return;
    }
    setUploadError(null);
    setVisionProgress({ current: 0, total: 1, status: "Reading page count..." });
    try {
      const pageCount = await getPdfPageCount(file);
      const suggestedEnd = Math.min(100, pageCount);
      setVisionConfig({ file, pageCount, startPage: 1, endPage: suggestedEnd });
    } catch {
      setUploadError("Could not read PDF page count.");
    } finally {
      setVisionProgress(null);
      if (visionFileInputRef.current) visionFileInputRef.current.value = "";
    }
  }, []);

  const handleVisionUpload = useCallback(async () => {
    if (!visionConfig) return;
    const { file, pageCount, startPage, endPage } = visionConfig;
    const clampedStart = Math.max(1, Math.min(startPage, pageCount));
    const clampedEnd = Math.max(clampedStart, Math.min(endPage, pageCount));

    setUploadError(null);
    setVisionProgress({ current: 0, total: clampedEnd - clampedStart + 1, status: "Starting..." });

    try {
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const title = pageCount <= clampedEnd && clampedStart === 1
        ? baseName
        : `${baseName} (pp. ${clampedStart}–${clampedEnd})`;

      await visionUpload.mutateAsync({
        file,
        title,
        startPage: clampedStart,
        endPage: clampedEnd,
        onProgress: (current, total, status) => {
          setVisionProgress({ current, total, status });
        },
      });
      setVisionConfig(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Vision upload failed");
    } finally {
      setVisionProgress(null);
    }
  }, [visionConfig, visionUpload]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const toggleDoc = useCallback((id: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">CONFIGURATION</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Library className="h-5 w-5" />
            Reference Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The canonical source for platform-specific technical documentation.
            Upload Siemens manuals, SCL function references, and PLC model
            specifications here. Agents automatically look up relevant sections
            during code generation and review.
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !!visionProgress}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload (Text)
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => visionFileInputRef.current?.click()}
            disabled={uploading || !!visionProgress}
            title="Uses AI vision to extract text, tables, and describe images/diagrams from PDF pages"
          >
            {visionProgress ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            Upload PDF (Vision)
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
          }}
        />
        <input
          ref={visionFileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleVisionFileSelect(f);
          }}
        />
      </div>

      <Separator />

      {/* Guidance card */}
      <Card className="border-primary/20 bg-primary/5 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
          What belongs here
        </h3>
        <ul className="mt-1.5 space-y-1 font-mono text-xs text-muted-foreground">
          <li>Siemens TIA Portal manuals and programming guides</li>
          <li>SCL language references and built-in function documentation</li>
          <li>PLC model specifications (S7-1200, S7-1500 feature matrices)</li>
          <li>IEC 61131-3 standard excerpts</li>
          <li>Hardware module datasheets with addressing details</li>
        </ul>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
          For project-specific rules and operational guidelines, use the{" "}
          <span className="text-primary">Knowledge</span> page instead.
        </p>
      </Card>

      {/* Upload error */}
      {uploadError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Vision page range configurator */}
      {visionConfig && !visionProgress && (
        <Card className="space-y-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-medium">Configure Vision Upload</span>
            <span className="font-mono text-xs text-muted-foreground">
              {visionConfig.file.name} &middot; {visionConfig.pageCount} pages total
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            Process up to 100 pages at a time to avoid memory issues. Upload the same file multiple times with different page ranges to cover the full document.
          </p>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="font-mono text-xs">Start page</Label>
              <Input
                type="number"
                min={1}
                max={visionConfig.pageCount}
                value={visionConfig.startPage}
                onChange={(e) => setVisionConfig((c) => c && ({ ...c, startPage: parseInt(e.target.value) || 1 }))}
                className="h-8 w-24 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-xs">End page</Label>
              <Input
                type="number"
                min={1}
                max={visionConfig.pageCount}
                value={visionConfig.endPage}
                onChange={(e) => setVisionConfig((c) => c && ({ ...c, endPage: parseInt(e.target.value) || 1 }))}
                className="h-8 w-24 font-mono text-xs"
              />
            </div>
            <Button size="sm" onClick={handleVisionUpload} className="gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              Start Upload
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setVisionConfig(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Uploading indicator */}
      {uploading && (
        <Card className="flex items-center gap-3 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Extracting and indexing document... Large PDFs may take a minute or two.
          </span>
        </Card>
      )}

      {/* Vision upload progress */}
      {visionProgress && (
        <Card className="space-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Eye className="h-4 w-4 shrink-0 text-primary animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">AI Vision Processing</div>
              <div className="text-xs text-muted-foreground">{visionProgress.status}</div>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {visionProgress.current}/{visionProgress.total}
            </span>
          </div>
          <Progress
            value={visionProgress.total > 0 ? (visionProgress.current / visionProgress.total) * 100 : 0}
            className="h-1.5"
          />
        </Card>
      )}

      {/* Document list */}
      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading reference documents...
        </div>
      )}

      {docs && docs.length === 0 && !isLoading && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 px-4 py-12 text-center transition-colors hover:border-muted-foreground/50 hover:bg-accent/30"
        >
          <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <div className="text-sm text-muted-foreground">
            Drop reference documents here or click to browse
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground/60">
            Supports .md, .txt, .docx, .scl, .pdf
          </div>
          <div className="mt-3 text-xs text-muted-foreground/60">
            Documents are split into sections and indexed with topic tags.
            During generation, agents automatically retrieve relevant sections.
          </div>
        </div>
      )}

      {docs && docs.length > 0 && (
        <ScrollArea className="h-[calc(100vh-14rem)]">
          <div className="space-y-3 pr-3">
            {docs.map((doc) => {
              const isExpanded = expandedDocs.has(doc.id);
              return (
                <Card key={doc.id} className="overflow-hidden">
                  {/* Doc header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => toggleDoc(doc.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {doc.title}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 px-1.5 py-0 font-mono text-[9px]"
                        >
                          {doc.file_type.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span>{doc.section_count} sections</span>
                        <span>&middot;</span>
                        <span>
                          {(doc.total_chars / 1000).toFixed(1)}K chars
                        </span>
                        <span>&middot;</span>
                        <span>{doc.source_filename}</span>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete reference document?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove &ldquo;{doc.title}
                            &rdquo; and all {doc.section_count} sections. This
                            action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteDoc.mutate(doc.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* Expanded: section list */}
                  {isExpanded && (
                    <div className="border-t">
                      <SectionsList docId={doc.id} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Additional drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className={cn(
              "mt-3 rounded-md border border-dashed border-muted-foreground/20 px-3 py-2",
              "text-center font-mono text-xs text-muted-foreground/50",
              "transition-colors hover:border-muted-foreground/40",
            )}
          >
            Drop more files here to add to reference library
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
