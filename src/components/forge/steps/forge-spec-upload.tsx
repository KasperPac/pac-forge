import { useRef, useState, useCallback } from "react";
import { Upload, FileText, X, ChevronRight, Loader2, AlertCircle, Check, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useForgeSpecAnalysis } from "@/hooks/use-forge-spec-analysis";
import { useForgeSpecChallenge, mergeChallenge } from "@/hooks/use-forge-spec-challenge";
import { useForgeSpecValidate, applyValidationPatches } from "@/hooks/use-forge-spec-validate";
import { useForgeChunkedAnalysis } from "@/hooks/use-forge-chunked-analysis";
import { extractTextFromDocx, extractTextFromPdf } from "@/lib/document-extractor";
import { SpecDepthDialog } from "@/components/forge/spec-depth-dialog";
import type { SpecAnalysis, SpecAnalysisDepth } from "@/types/forge";
import { CHUNKED_THRESHOLD } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface ForgeSpecUploadProps {
  onComplete: (specText: string, specFilename: string, analysis: SpecAnalysis) => void;
  onSkip: () => void;
  fbTemplates?: FbTemplate[];
}

type PassStatus = "pending" | "running" | "done" | "skipped";

interface PassState {
  survey: PassStatus;
  extract: PassStatus;
  challenge: PassStatus;
  validate: PassStatus;
}

/** Expandable device row showing IO signals on click */
function DeviceRow({ device: d, expanded, onToggle }: {
  device: import("@/types/forge").SpecAnalysisDevice;
  expanded: boolean;
  onToggle: () => void;
}) {
  const signals = d.io_signals ?? [];
  return (
    <div className="ml-4 border-t border-border/20">
      <div
        className="flex items-center gap-3 px-3 py-1 hover:bg-muted/20 cursor-pointer"
        onClick={onToggle}
      >
        <ChevronRight className={`h-3 w-3 text-muted-foreground/50 transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span className="font-mono text-xs w-32 truncate">{d.name}</span>
        <span className="font-mono text-[10px] text-muted-foreground w-24 truncate">{d.tag}</span>
        <span className="text-[11px] w-36 truncate">{d.device_type}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{signals.length} IO</span>
      </div>
      {expanded && signals.length > 0 && (
        <div className="ml-8 pb-1.5 pl-3 flex flex-wrap gap-1.5">
          {signals.map((sig) => (
            <div key={sig.tag_name} className="flex items-center gap-1 rounded border border-border/30 bg-background/40 px-1.5 py-0.5">
              <span className={`font-mono text-[9px] font-semibold ${
                sig.signal_type === "DI" ? "text-green-400" :
                sig.signal_type === "DQ" ? "text-orange-400" :
                sig.signal_type === "AI" ? "text-cyan-400" :
                "text-purple-400"
              }`}>{sig.signal_type}</span>
              <span className="font-mono text-[10px]">{sig.tag_name}</span>
              {sig.description && (
                <span className="text-[9px] text-muted-foreground/60">— {sig.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ForgeSpecUpload({ onComplete, onSkip, fbTemplates }: ForgeSpecUploadProps) {
  const { analyze } = useForgeSpecAnalysis();
  const { challenge } = useForgeSpecChallenge();
  const { validate } = useForgeSpecValidate();
  const { analyzeChunked, progress: chunkProgress } = useForgeChunkedAnalysis();

  const [analysis, setAnalysis] = useState<SpecAnalysis | null>(null);
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<Set<string>>(new Set());
  const [specText, setSpecText] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [depthDialogOpen, setDepthDialogOpen] = useState(false);
  const [passState, setPassState] = useState<PassState>({
    survey: "pending",
    extract: "pending",
    challenge: "pending",
    validate: "pending",
  });
  const [surveyStats, setSurveyStats] = useState<{ targets: number } | null>(null);
  const [challengeStats, setChallengeStats] = useState<{ gaps: number } | null>(null);
  const [validateStats, setValidateStats] = useState<{ findings: number; patches: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // File extraction — runs before the depth dialog
  const processFile = useCallback(async (file: File) => {
    setError(null);
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
      // Open depth dialog after successful extraction
      setDepthDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExtracting(false);
    }
  }, []);

  // Multi-pass analysis — runs after depth selection
  const runAnalysis = useCallback(
    async (depth: SpecAnalysisDepth) => {
      if (!specText) return;
      setDepthDialogOpen(false);
      setAnalyzing(true);
      setError(null);
      setChallengeStats(null);
      setValidateStats(null);
      setSurveyStats(null);

      const useChunked = specText.length > CHUNKED_THRESHOLD;

      setPassState({
        survey: useChunked ? "running" : "skipped",
        extract: useChunked ? "pending" : "running",
        challenge: depth >= 2 ? "pending" : "skipped",
        validate: depth >= 3 ? "pending" : "skipped",
      });

      try {
        let result: SpecAnalysis;

        if (useChunked) {
          // ── Chunked path: survey → extract per chunk → merge ──
          result = await analyzeChunked(specText, fbTemplates);
          setSurveyStats({ targets: chunkProgress.totalChunks });
          setPassState((prev) => ({
            ...prev,
            survey: "done",
            extract: "done",
            challenge: depth >= 2 ? "running" : prev.challenge,
          }));
        } else {
          // ── Single-shot path (small specs) ──
          result = await analyze(specText, fbTemplates);
          setPassState((prev) => ({
            ...prev,
            extract: "done",
            challenge: depth >= 2 ? "running" : prev.challenge,
          }));
        }

        // Pass 2: Challenge (Gemini)
        if (depth >= 2) {
          const challengeResult = await challenge(specText, result);
          const totalGaps =
            challengeResult.missing_trigger_conditions.length +
            challengeResult.missing_process_settings.length +
            challengeResult.missing_devices.length +
            challengeResult.missing_alarms.length +
            challengeResult.missing_interlocks.length +
            challengeResult.general_gaps.length;
          setChallengeStats({ gaps: totalGaps });
          result = mergeChallenge(result, challengeResult);
          setPassState((prev) => ({
            ...prev,
            challenge: "done",
            validate: depth >= 3 ? "running" : prev.validate,
          }));
        }

        // Pass 3: Validate (Claude checklist)
        if (depth >= 3) {
          const validationResult = await validate(specText, result);
          setValidateStats({
            findings: validationResult.findings.length,
            patches: validationResult.patches.length,
          });
          if (validationResult.patches.length > 0) {
            result = applyValidationPatches(result, validationResult.patches);
          }
          setPassState((prev) => ({ ...prev, validate: "done" }));
        }

        setAnalysis(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setAnalyzing(false);
      }
    },
    [specText, fbTemplates, analyze, analyzeChunked, challenge, validate, chunkProgress.totalChunks],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const isLoading = extracting || analyzing;

  // ---------- Mode A — no spec yet ----------
  if (!analysis) {
    return (
      <div className="flex h-full flex-col gap-4">
        <SpecDepthDialog
          open={depthDialogOpen}
          onSelect={runAnalysis}
          onCancel={() => {
            setDepthDialogOpen(false);
            setSpecText(null);
            setFilename(null);
          }}
          specLength={specText?.length}
        />

        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            {extracting ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="font-mono text-sm text-muted-foreground">Extracting text...</p>
              </>
            ) : (
              <div className="flex flex-col gap-2.5 w-full max-w-sm">
                <p className="font-mono text-sm font-medium text-center mb-2">Analyzing specification</p>
                <PassIndicator
                  label="Survey"
                  sublabel="Section map"
                  status={passState.survey}
                  stats={surveyStats ? `${surveyStats.targets} extraction targets` : null}
                />
                <PassIndicator
                  label="Extract"
                  sublabel={passState.survey !== "skipped" && chunkProgress.totalChunks > 0
                    ? `${chunkProgress.currentChunk}/${chunkProgress.totalChunks}`
                    : "Claude"}
                  status={passState.extract}
                  stats={passState.survey !== "skipped" && passState.extract === "running"
                    ? [
                        chunkProgress.chunkName,
                        chunkProgress.streamStats
                          ? `${chunkProgress.streamStats.devices} devices, ${chunkProgress.streamStats.assemblies} asm, ${chunkProgress.streamStats.sequences} seq`
                          : null,
                      ].filter(Boolean).join(" — ")  || null
                    : null}
                />
                <PassIndicator
                  label="Challenge"
                  sublabel="Gemini"
                  status={passState.challenge}
                  stats={challengeStats ? `${challengeStats.gaps} gaps found` : null}
                />
                <PassIndicator
                  label="Validate"
                  sublabel="Checklist"
                  status={passState.validate}
                  stats={
                    validateStats
                      ? `${validateStats.findings} findings, ${validateStats.patches} patches`
                      : null
                  }
                />
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
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
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
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

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
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

  // ---------- Mode B — analysis complete ----------
  const alarms = analysis.alarms ?? [];
  const immediateShutdowns = alarms.filter((a) => a.severity === "IMMEDIATE_SHUTDOWN").length;
  const controlled = alarms.filter((a) => a.severity === "CONTROLLED_SHUTDOWN").length;
  const warnings = alarms.filter((a) => a.severity === "WARNING").length;

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
              onClick={() => {
                setAnalysis(null);
                setSpecText(null);
                setFilename(null);
              }}
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
                <Badge variant="destructive" className="font-mono text-[10px]">
                  {immediateShutdowns}
                </Badge>
              </div>
            )}
            {controlled > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Controlled shutdown</span>
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] text-yellow-500 border-yellow-500/50"
                >
                  {controlled}
                </Badge>
              </div>
            )}
            {warnings > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Warnings</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {warnings}
                </Badge>
              </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t border-border/60">
              <span className="text-muted-foreground">Interlocks</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {(analysis.interlocks ?? []).length}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: detailed results */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Machine hierarchy: Subsystems → Assemblies → Devices */}
        <Card className="min-h-0 flex-1 border-border/70 bg-card/70">
          <CardHeader className="border-b border-border/60 pb-3 pt-4">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm">
                Machine Hierarchy
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                {(analysis.subsystems ?? []).length} subsystems
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px] border-blue-500/40 text-blue-400">
                {(analysis.assemblies ?? []).length} assemblies
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {(analysis.devices ?? []).length} devices
              </Badge>
            </div>
          </CardHeader>
          <div className="p-2 space-y-1">
              {(() => {
                const subsystems = analysis.subsystems ?? [];
                const assemblies = analysis.assemblies ?? [];
                const devices = analysis.devices ?? [];
                const assemblyDeviceIds = new Set(assemblies.flatMap((a) => a.device_ids));
                const deviceMap = new Map(devices.map((d) => [d.id, d]));

                return subsystems.map((sub) => {
                  const subAssemblies = assemblies.filter((a) => a.subsystem === sub.name);
                  const subDevices = devices.filter(
                    (d) => d.subsystem === sub.name && !assemblyDeviceIds.has(d.id),
                  );

                  return (
                    <div key={sub.name} className="rounded border border-border/40 bg-muted/5">
                      {/* Subsystem header */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
                        <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                          SS
                        </Badge>
                        <span className="font-mono text-xs font-semibold">{sub.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{sub.description}</span>
                      </div>

                      {/* Assemblies in this subsystem */}
                      {subAssemblies.map((asm) => {
                        const asmDevices = asm.device_ids
                          .map((id) => deviceMap.get(id))
                          .filter(Boolean);
                        return (
                          <div key={asm.id} className="ml-4 border-l-2 border-blue-500/30">
                            {/* Assembly header */}
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/5">
                              <Badge variant="outline" className="font-mono text-[10px] px-1 py-0 border-blue-500/40 text-blue-400">
                                ASM
                              </Badge>
                              <span className="font-mono text-xs font-semibold text-blue-300/80">{asm.name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">({asm.assembly_type})</span>
                              <span className="font-mono text-[10px] text-muted-foreground/60">{asmDevices.length} devices</span>
                            </div>
                            {/* Devices in this assembly */}
                            {asmDevices.map((d) => d && (
                              <DeviceRow key={d.id} device={d} expanded={expandedDeviceIds.has(d.id)} onToggle={() => {
                                setExpandedDeviceIds((prev) => {
                                  const next = new Set(prev);
                                  next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                                  return next;
                                });
                              }} />
                            ))}
                          </div>
                        );
                      })}

                      {/* Standalone devices (not in any assembly) */}
                      {subDevices.length > 0 && (
                        <div className="ml-4 border-l-2 border-border/30">
                          {subAssemblies.length > 0 && (
                            <div className="px-3 py-1 text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                              Standalone
                            </div>
                          )}
                          {subDevices.map((d) => (
                            <DeviceRow key={d.id} device={d} expanded={expandedDeviceIds.has(d.id)} onToggle={() => {
                              setExpandedDeviceIds((prev) => {
                                const next = new Set(prev);
                                next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                                return next;
                              });
                            }} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
          </div>
        </Card>

        {/* Process sequences */}
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">
              Process Sequences
              <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                {(analysis.process_sequences ?? []).length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-4">
            {(analysis.process_sequences ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">None extracted</p>
            ) : (
              (analysis.process_sequences ?? []).map((seq, i) => {
                const triggersCount = seq.steps.filter((s) => s.trigger_condition).length;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-border/50 bg-background/40 px-3 py-2"
                  >
                    <span className="text-sm">{seq.name}</span>
                    <div className="flex items-center gap-2">
                      {triggersCount > 0 && (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] text-emerald-500 border-emerald-500/50"
                        >
                          {triggersCount} triggers
                        </Badge>
                      )}
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {seq.steps.length} steps
                      </Badge>
                    </div>
                  </div>
                );
              })
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

// ---------------------------------------------------------------------------
// Pass progress indicator
// ---------------------------------------------------------------------------

function PassIndicator({
  label,
  sublabel,
  status,
  stats,
}: {
  label: string;
  sublabel: string;
  status: PassStatus;
  stats: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-6 w-6 items-center justify-center">
        {status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {status === "done" && <Check className="h-4 w-4 text-emerald-500" />}
        {status === "pending" && <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}
        {status === "skipped" && (
          <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-xs ${
              status === "running"
                ? "text-primary font-medium"
                : status === "done"
                  ? "text-foreground"
                  : "text-muted-foreground/60"
            }`}
          >
            {label}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/50">{sublabel}</span>
        </div>
        {stats && status === "done" && (
          <p className="font-mono text-[10px] text-muted-foreground">{stats}</p>
        )}
      </div>
    </div>
  );
}
