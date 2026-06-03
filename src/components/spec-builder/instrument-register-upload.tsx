import { useState, useRef, useCallback } from "react";
import { saveAs } from "file-saver";
import {
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import { buildRegisterTemplateBlob } from "@/lib/spec-builder/register-template";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { parseInstrumentRegister } from "@/lib/spec-builder/instrument-parser";
import { useSaveInstrumentRegister } from "@/hooks/use-spec-projects";
import type { ParseResult } from "@/lib/spec-builder/instrument-parser";
import type { InstrumentTag, ParseWarning } from "@/types/spec-builder";

interface Props {
  specProjectId: string;
  onParsed?: (result: ParseResult) => void;
}

export function InstrumentRegisterUpload({ specProjectId, onParsed }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [parsing, setParsing] = useState(false);
  const [progressStage, setProgressStage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);

  const saveRegister = useSaveInstrumentRegister();

  const handleDownloadTemplate = () => {
    saveAs(buildRegisterTemplateBlob(), "pac-register-template.xlsx");
  };

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      setError(null);
      setResult(null);
      abortRef.current = new AbortController();

      try {
        const parsed = await parseInstrumentRegister(
          file,
          abortRef.current.signal,
          (stage, done, total) => {
            setProgressStage(stage);
            setProgressPercent(total > 0 ? Math.round((done / total) * 100) : 0);
          }
        );

        setResult(parsed);

        // Save to Supabase
        await saveRegister.mutateAsync({
          spec_project_id: specProjectId,
          raw_filename: file.name,
          tags: parsed.tags,
          subsystems: parsed.subsystems,
          parse_warnings: parsed.warnings,
          haiku_usage: parsed.usage,
        });

        onParsed?.(parsed);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Parse failed");
      } finally {
        setParsing(false);
      }
    },
    [specProjectId, saveRegister, onParsed]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div className="space-y-4">
      {/* Template download */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download template
        </Button>
      </div>

      {/* Upload zone */}
      <Card
        className={cn(
          "border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
          parsing
            ? "border-muted cursor-wait"
            : "border-muted-foreground/25 hover:border-primary/50"
        )}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !parsing && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={onFileSelect}
        />
        {parsing ? (
          <div className="space-y-3">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">{progressStage}</p>
            <Progress value={progressPercent} className="max-w-xs mx-auto" />
          </div>
        ) : (
          <div className="space-y-2">
            <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop instrument register file or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Supports .xlsx, .xls, .csv
            </p>
          </div>
        )}
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary badges */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {result.tags.length} tags parsed
            </Badge>
            <Badge variant="secondary" className="gap-1">
              {result.subsystems.length} assemblies
            </Badge>
            {result.warnings.length > 0 && (
              <Badge variant="outline" className="gap-1 text-amber-400 border-amber-400/50">
                <AlertTriangle className="h-3 w-3" />
                {result.warnings.length} warnings
              </Badge>
            )}
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              Sonnet: {result.usage.total?.toLocaleString()} tokens
            </Badge>
          </div>

          {/* Subsystem cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {result.subsystems.map((sub) => (
              <Card key={sub.subsystem_id} className="p-3 space-y-1">
                <p className="text-sm font-mono font-medium truncate">
                  {sub.subsystem_name}
                </p>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {sub.equipment_type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {sub.tag_count} tags
                  </span>
                </div>
              </Card>
            ))}
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <Card className="p-0">
              <div className="px-4 py-2 border-b flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium">Parse Warnings</span>
              </div>
              <ScrollArea className="max-h-48">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Tag</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="w-24">Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.warnings.map((w, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{w.tag}</TableCell>
                        <TableCell className="text-xs">{w.reason}</TableCell>
                        <TableCell>
                          <WarningSeverityBadge warning={w} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </Card>
          )}

          {/* Tag table preview */}
          <Card className="p-0">
            <div className="px-4 py-2 border-b">
              <span className="text-sm font-medium">Parsed Tags ({result.tags.length})</span>
            </div>
            <div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Tag</TableHead>
                    <TableHead className="w-28">Class</TableHead>
                    <TableHead className="w-20">Signal</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-32">Subsystem</TableHead>
                    <TableHead className="w-16">Safety</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.tags.map((tag, i) => (
                    <TagRow key={i} tag={tag} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Re-upload button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Re-upload
          </Button>
        </div>
      )}
    </div>
  );
}

function TagRow({ tag }: { tag: InstrumentTag }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{tag.tag}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {tag.device_class}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn("text-xs", {
            "text-blue-400 border-blue-400/50": tag.signal_direction === "DI",
            "text-green-400 border-green-400/50": tag.signal_direction === "DO",
            "text-purple-400 border-purple-400/50": tag.signal_direction === "AI",
            "text-orange-400 border-orange-400/50": tag.signal_direction === "AO",
          })}
        >
          {tag.signal_direction}
        </Badge>
      </TableCell>
      <TableCell className="text-xs max-w-[200px] truncate">
        {tag.description}
      </TableCell>
      <TableCell className="font-mono text-xs">{tag.subsystem}</TableCell>
      <TableCell>
        {tag.is_safety && (
          <Badge variant="destructive" className="text-xs">
            Safety
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function WarningSeverityBadge({ warning }: { warning: ParseWarning }) {
  if (warning.severity === "error") {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <XCircle className="h-3 w-3" /> Error
      </Badge>
    );
  }
  if (warning.severity === "warning") {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-amber-400 border-amber-400/50">
        <AlertTriangle className="h-3 w-3" /> Warning
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
      <Info className="h-3 w-3" /> Info
    </Badge>
  );
}
