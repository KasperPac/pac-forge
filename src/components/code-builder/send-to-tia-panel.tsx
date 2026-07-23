/**
 * Send to TIA panel — dialog from the Code Builder header. Assembles the
 * full generated program (all layers, Code Builder edits overlaid), previews
 * what will be sent, pushes it through the bridge's delete+reimport+compile,
 * and shows the per-block compile results.
 */
import { Hammer, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function SendToTiaPanel({
  specId,
  revision,
}: {
  specId: string;
  revision: number | undefined;
}) {
  const { buildPlan, plan, planning, error, send, sending, tagResult, compileResult, sendError } =
    useSendCodeToTia(specId, revision);

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
            </>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {sendError && <p className="text-xs text-destructive">{sendError}</p>}
        {plan && plan.warnings.length > 0 && (
          <div className="space-y-0.5">
            {plan.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600">{w}</p>
            ))}
          </div>
        )}

        {plan && !compileResult && (
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

        {compileResult && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">
              Compile: {compileResult.success ? "SUCCESS" : `${compileResult.errors.length} error(s)`}
              {compileResult.warnings.length ? ` · ${compileResult.warnings.length} warning(s)` : ""}
            </p>
            <ScrollArea className="h-48 rounded-md border">
              <ul className="space-y-1 p-2 text-[10px]">
                {[...compileResult.errors, ...compileResult.warnings].map((e, i) => (
                  <li key={i} className={e.severity === "ERROR" ? "text-destructive" : "text-muted-foreground"}>
                    <span className="font-mono">
                      {e.artifact_name}
                      {e.line !== null ? `:${e.line}` : ""}
                    </span>{" "}
                    [{e.severity}] {e.error_text}
                  </li>
                ))}
                {compileResult.success && compileResult.errors.length === 0 && (
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
