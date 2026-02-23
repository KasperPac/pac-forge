import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Loader2, Play, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractTextFromDocx } from "@/lib/document-extractor";

interface ProcessUploadPaneProps {
  onGenerate: (text: string) => void;
  generating: boolean;
}

export function ProcessUploadPane({ onGenerate, generating }: ProcessUploadPaneProps) {
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (selectedFile: File) => {
    setError(null);
    setExtractedText(null);

    if (!selectedFile.name.endsWith(".docx")) {
      setError("Only .docx files are supported. PDF support coming soon.");
      return;
    }

    setFile(selectedFile);
    setExtracting(true);

    try {
      const text = await extractTextFromDocx(selectedFile);
      if (!text.trim()) {
        setError("The document appears to be empty.");
        setExtracting(false);
        return;
      }
      setExtractedText(text);
    } catch (err) {
      setError(`Failed to extract text: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFile(droppedFile);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  function handleClear() {
    setFile(null);
    setExtractedText(null);
    setError(null);
    setShowPreview(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const wordCount = extractedText ? extractedText.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Process Code</div>
            <div className="font-mono text-xs text-muted-foreground">
              Upload a functional description to generate process control code
            </div>
          </div>
          {file && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={handleClear}
              title="Clear document"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Drop zone */}
          {!file && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 px-4 py-12 text-center transition-colors hover:border-muted-foreground/50 hover:bg-accent/30"
            >
              <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
              <div className="font-mono text-sm text-muted-foreground">
                Drop a .docx file here or click to browse
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground/60">
                Functional description document
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          )}

          {/* Extracting indicator */}
          {extracting && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="font-mono text-sm text-muted-foreground">
                Extracting text...
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {error}
            </div>
          )}

          {/* File info + preview */}
          {file && extractedText && (
            <>
              <Card className="p-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm font-medium">{file.name}</div>
                    <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      <span>{(file.size / 1024).toFixed(1)} KB</span>
                      <span>&middot;</span>
                      <span>{wordCount.toLocaleString()} words</span>
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs">
                    Ready
                  </Badge>
                </div>
              </Card>

              {/* Text preview toggle */}
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/50"
              >
                {showPreview ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Preview extracted text
              </button>

              {showPreview && (
                <div className="max-h-64 overflow-auto rounded-md border bg-black/20 px-3 py-2">
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                    {extractedText.slice(0, 5000)}
                    {extractedText.length > 5000 && "\n\n... (truncated)"}
                  </pre>
                </div>
              )}

              {/* Generate button */}
              <Button
                className="w-full gap-2"
                onClick={() => onGenerate(extractedText)}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating Process Code...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Generate Process Code
                  </>
                )}
              </Button>
            </>
          )}

          {/* Tips when idle */}
          {!file && !extracting && (
            <div className="space-y-2 pt-4">
              <div className="font-mono text-xs font-medium text-muted-foreground">
                What gets generated:
              </div>
              <ul className="space-y-1 font-mono text-xs text-muted-foreground/80">
                <li>&bull; Sequence FBs with CASE-based state machines</li>
                <li>&bull; Interlock logic (permissives, safety conditions)</li>
                <li>&bull; HMI interface tags (status, commands, setpoints)</li>
                <li>&bull; Alarm management (latching with operator reset)</li>
                <li>&bull; Main OB tying all process blocks together</li>
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
