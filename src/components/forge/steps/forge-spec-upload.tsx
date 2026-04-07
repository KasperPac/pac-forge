import { useRef, useState, useCallback } from "react";
import { Upload, FileText, X, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useForgeSpecAnalysis } from "@/hooks/use-forge-spec-analysis";
import { extractTextFromDocx, extractTextFromPdf } from "@/lib/document-extractor";
import type { SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface ForgeSpecUploadProps {
  onComplete: (specText: string, specFilename: string, analysis: SpecAnalysis) => void;
  onSkip: () => void;
  fbTemplates?: FbTemplate[];
}

export function ForgeSpecUpload({ onComplete, onSkip, fbTemplates }: ForgeSpecUploadProps) {
  const { analyze, loading, error } = useForgeSpecAnalysis();
  const [analysis, setAnalysis] = useState<SpecAnalysis | null>(null);
  const [specText, setSpecText] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setExtractError(null);
    setExtracting(true);
    try {
      let text: string;
      if (file.name.endsWith(".docx")) {
        text = await extractTextFromDocx(file);
      } else if (file.name.endsWith(".pdf")) {
        text = await extractTextFromPdf(file);
      } else {
        throw new Error("Unsupported file type. Upload a .docx or .pdf file.");
      }
      setSpecText(text);
      setFilename(file.name);
      setExtracting(false);

      const result = await analyze(text, fbTemplates);
      setAnalysis(result);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
      setExtracting(false);
    }
  }, [analyze]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const isLoading = extracting || loading;

  // Mode A — no spec yet
  if (!analysis) {
    return (
      <div className="flex h-full flex-col gap-4">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-mono text-sm text-muted-foreground">
              {extracting ? "Extracting text…" : "Analyzing specification…"}
            </p>
          </div>
        ) : (
          <>
            <div
              className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop a functional spec here</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  .docx or .pdf — up to 100 MB
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                Browse file
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".docx,.pdf"
                className="hidden"
                onChange={onFileChange}
              />
            </div>

            {(extractError ?? error) && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {extractError ?? error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border/60" />
              <span className="font-mono text-xs text-muted-foreground">OR</span>
              <div className="h-px flex-1 bg-border/60" />
            </div>

            <Button variant="ghost" className="w-full" onClick={onSkip}>
              Start from scratch — fill in project details manually
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    );
  }

  // Mode B — analysis complete
  const alarms = analysis.alarms ?? [];
  const immediateShutdowns = alarms.filter(a => a.severity === "IMMEDIATE_SHUTDOWN").length;
  const controlled = alarms.filter(a => a.severity === "CONTROLLED_SHUTDOWN").length;
  const warnings = alarms.filter(a => a.severity === "WARNING").length;

  return (
    <div className="flex h-full gap-4">
      {/* Left: file info */}
      <div className="flex w-[38%] shrink-0 flex-col gap-3">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              Uploaded Spec
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="font-mono text-xs text-muted-foreground break-all">{filename}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {specText ? `${Math.round(specText.length / 1000)}K chars extracted` : ""}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => { setAnalysis(null); setSpecText(null); setFilename(null); }}
            >
              <X className="mr-2 h-3.5 w-3.5" />
              Replace file
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-4 text-sm">
            <div>
              <span className="font-mono text-xs text-muted-foreground">Project</span>
              <p className="mt-0.5 font-medium">{analysis.project_name || "—"}</p>
            </div>
            <div>
              <span className="font-mono text-xs text-muted-foreground">PLC</span>
              <p className="mt-0.5">{analysis.plc_type || "—"}</p>
            </div>
            <div>
              <span className="font-mono text-xs text-muted-foreground">HMI</span>
              <p className="mt-0.5">{analysis.hmi_type || "—"}</p>
            </div>
            <div>
              <span className="font-mono text-xs text-muted-foreground">Description</span>
              <p className="mt-0.5 text-muted-foreground">{analysis.project_description || "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Alarms & Interlocks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-4 text-sm">
            {immediateShutdowns > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Immediate shutdown</span>
                <Badge variant="destructive" className="font-mono text-[10px]">{immediateShutdowns}</Badge>
              </div>
            )}
            {controlled > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Controlled shutdown</span>
                <Badge variant="outline" className="font-mono text-[10px] text-yellow-500 border-yellow-500/50">{controlled}</Badge>
              </div>
            )}
            {warnings > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Warnings</span>
                <Badge variant="outline" className="font-mono text-[10px]">{warnings}</Badge>
              </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t border-border/60">
              <span className="text-muted-foreground">Interlocks</span>
              <Badge variant="outline" className="font-mono text-[10px]">{(analysis.interlocks ?? []).length}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: detailed results */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Devices table */}
        <Card className="min-h-0 flex-1 border-border/70 bg-card/70">
          <CardHeader className="border-b border-border/60 pb-3 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Devices
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">{(analysis.devices ?? []).length}</Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <ScrollArea className="max-h-[400px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card/90">
                <tr className="border-b border-border/60">
                  {["Name", "Tag", "Type", "Subsystem", "IO"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {analysis.devices.map((d, i) => (
                  <tr key={d.id ?? i} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-mono text-xs">{d.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{d.tag}</td>
                    <td className="px-3 py-1.5 text-xs">{d.device_type}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.subsystem}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{(d.io_signals ?? []).length}</td>
                    <td className="px-2">
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setAnalysis(prev => prev ? { ...prev, devices: prev.devices.filter((_, j) => j !== i) } : prev)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>

        {/* Process sequences */}
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">
              Process Sequences
              <Badge variant="outline" className="ml-2 font-mono text-[10px]">{(analysis.process_sequences ?? []).length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-4">
            {(analysis.process_sequences ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">None extracted</p>
            ) : (
              (analysis.process_sequences ?? []).map((seq, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border/50 bg-background/40 px-3 py-2">
                  <span className="text-sm">{seq.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{seq.steps.length} steps</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full"
          onClick={() => specText && filename && onComplete(specText, filename, analysis)}
        >
          Confirm & Continue
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
