/**
 * Send to TIA panel — dialog from the Code Builder header. Assembles the
 * full generated program (all layers, Code Builder edits overlaid), previews
 * what will be sent, pushes it through the bridge's delete+reimport+compile,
 * and shows the per-block compile results.
 */
import { useState } from "react";
import { FolderPlus, Hammer, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSendCodeToTia } from "@/hooks/use-send-code-to-tia";

const PROJECT_FOLDER_KEY = "pacforge.tia.projectFolder";

export function SendToTiaPanel({
  specId,
  revision,
  defaultProjectName,
}: {
  specId: string;
  revision: number | undefined;
  /** Seeds the fresh-build project name — the spec's doc code or title. */
  defaultProjectName?: string;
}) {
  const {
    buildPlan, plan, planning, error, send, sending, tagResult, compileResult, sendError,
    provisionFresh, provisioning, provisionSteps, provisionResult,
  } = useSendCodeToTia(specId, revision);

  const [showFresh, setShowFresh] = useState(false);
  const [projectPath, setProjectPath] = useState(
    () => localStorage.getItem(PROJECT_FOLDER_KEY) ?? "",
  );
  const [projectName, setProjectName] = useState(defaultProjectName ?? "");
  const canBuildFresh =
    !!plan?.provision.cpuOrderNumber && projectPath.trim().length > 0 && projectName.trim().length > 0;
  // A fresh build's compile result renders through the same block as a reimport's.
  const shownCompile = compileResult ?? provisionResult?.compile_result ?? null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-[11px]">
          <Send className="h-3.5 w-3.5" />
          Send to TIA
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Send generated program to TIA</DialogTitle>
          <DialogDescription className="text-xs">
            Deletes + reimports every generated block in the open TIA project,
            then compiles all. TIA must be open with the target project and
            OFFLINE. Blocks you edited in the Code Builder are sent with your
            edits.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={planning} onClick={() => buildPlan()}>
            {planning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Assemble program
          </Button>
          {plan && (
            <>
              <div className="flex gap-1">
                {Object.entries(plan.countsByType).map(([t, n]) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {n} {t}
                  </Badge>
                ))}
                {plan.ioTags.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {plan.ioTags.length} IO tags
                  </Badge>
                )}
                {plan.editedBlocks.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {plan.editedBlocks.length} edited
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                className="ml-auto h-7 gap-1 text-xs"
                disabled={sending}
                title="TIA must be open and offline; large programs take minutes — a timeout does not necessarily mean failure"
                onClick={() => void send(plan)}
              >
                {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hammer className="h-3 w-3" />}
                Import + compile
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowFresh((v) => !v)}
              >
                <FolderPlus className="h-3 w-3" />
                Create new project…
              </Button>
            </>
          )}
        </div>

        {plan && showFresh && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Creates a NEW TIA project with the CPU and IO modules from the FDS
              hardware model, imports the whole program, and compiles hardware +
              software. TIA must be open and OFFLINE; nothing needs to be loaded.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="fresh-folder" className="text-[11px]">Folder</Label>
                <Input
                  id="fresh-folder"
                  className="h-7 font-mono text-xs"
                  placeholder="C:\TIA_Projects"
                  value={projectPath}
                  onChange={(e) => {
                    setProjectPath(e.target.value);
                    localStorage.setItem(PROJECT_FOLDER_KEY, e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fresh-name" className="text-[11px]">Project name</Label>
                <Input
                  id="fresh-name"
                  className="h-7 font-mono text-xs"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </div>
            </div>

            {!plan.provision.cpuOrderNumber && (
              <p className="text-xs text-amber-600">
                Author a CPU in the skeleton wizard&apos;s Hardware step first — a
                project is never built with a guessed default CPU.
              </p>
            )}
            {plan.provision.missingOrderNumbers.length > 0 && (
              <p className="text-xs text-amber-600">
                No order number for {plan.provision.missingOrderNumbers.join(", ")} — these
                modules will not be plugged.
              </p>
            )}

            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={!canBuildFresh || provisioning}
              onClick={() =>
                void provisionFresh(plan, {
                  projectPath: projectPath.trim(),
                  projectName: projectName.trim(),
                })
              }
            >
              {provisioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
              Build project
            </Button>

            {provisionSteps.length > 0 && (
              <ul className="space-y-0.5 text-[10px]">
                {provisionSteps.map((s) => (
                  <li
                    key={s.label}
                    className={
                      s.state === "error"
                        ? "text-destructive"
                        : s.state === "done"
                          ? "text-muted-foreground"
                          : "font-medium"
                    }
                  >
                    {s.progress}% · {s.label}
                  </li>
                ))}
              </ul>
            )}

            {provisionResult && (
              <div className="space-y-1">
                <p className="text-xs">{provisionResult.message}</p>
                {provisionResult.created === false && (
                  <p className="text-xs text-amber-600">
                    A project already existed at that path, so the program was not
                    imported. Use Import + compile against the now-open project, or
                    pick a different folder or name.
                  </p>
                )}
                {provisionResult.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600">{w}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {sendError && <p className="text-xs text-destructive">{sendError}</p>}
        {plan && plan.warnings.length > 0 && (
          <div className="space-y-0.5">
            {plan.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600">{w}</p>
            ))}
          </div>
        )}

        {plan && !shownCompile && (
          <ScrollArea className="h-40 rounded-md border">
            <ul className="p-2 font-mono text-[10px] leading-relaxed">
              {Object.keys(plan.sources).map((n) => (
                <li key={n}>
                  {n}
                  {plan.editedBlocks.includes(n) ? "  (edited)" : ""}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        {tagResult && (
          <p className="text-xs text-muted-foreground">
            IO tags: {tagResult.created.length} created
            {tagResult.skipped.length ? ` · ${tagResult.skipped.length} skipped (already exist)` : ""}
            {tagResult.errors.length ? ` · ${tagResult.errors.length} failed` : ""}
          </p>
        )}

        {shownCompile && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">
              Compile: {shownCompile.success ? "SUCCESS" : `${shownCompile.errors.length} error(s)`}
              {shownCompile.warnings.length ? ` · ${shownCompile.warnings.length} warning(s)` : ""}
            </p>
            <ScrollArea className="h-48 rounded-md border">
              <ul className="space-y-1 p-2 text-[10px]">
                {[...shownCompile.errors, ...shownCompile.warnings].map((e, i) => (
                  <li key={i} className={e.severity === "ERROR" ? "text-destructive" : "text-muted-foreground"}>
                    <span className="font-mono">
                      {e.artifact_name}
                      {e.line !== null ? `:${e.line}` : ""}
                    </span>{" "}
                    [{e.severity}] {e.error_text}
                  </li>
                ))}
                {shownCompile.success && shownCompile.errors.length === 0 && (
                  <li className="text-muted-foreground">All blocks compiled clean.</li>
                )}
              </ul>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
