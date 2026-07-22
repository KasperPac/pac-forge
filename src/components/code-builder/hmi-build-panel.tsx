/**
 * HMI Build panel (G8-1) — dialog launched from the Code Builder header.
 * Runs the deterministic FDS → HMI compiler, previews the generated build
 * pack + manual steps, offers the spec/build-pack downloads, and pushes the
 * lowered spec to the bridge's /tia/hmi/build.
 */
import { useState } from "react";
import { Download, Hammer, Loader2, MonitorCog } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHmiBuild } from "@/hooks/use-hmi-build";

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function HmiBuildPanel({
  specId,
  projectName,
}: {
  specId: string;
  projectName?: string;
}) {
  const { generate, generating, run, error, buildInTia, building, bridgeResult } = useHmiBuild();
  const [connection, setConnection] = useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-[11px]">
          <MonitorCog className="h-3.5 w-3.5" />
          HMI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">HMI build — derived from the FDS</DialogTitle>
          <DialogDescription className="text-xs">
            Deterministic compiler: text lists, alarms, setpoints, screens and
            roles bound to the generated PLC blocks. Push to TIA via the bridge,
            or take the build pack for manual construction.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
            placeholder="HMI connection name in TIA (optional)"
            className="h-7 w-72 text-xs font-mono"
            aria-label="HMI connection name"
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={generating}
            onClick={() => generate(specId, { connection, projectName })}
          >
            {generating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Generate
          </Button>
          {run && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => download("hmi-build-spec.json", JSON.stringify(run.spec, null, 2), "application/json")}
              >
                <Download className="h-3 w-3" />
                Spec JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => download("HMI-BUILD-PACK.md", run.buildPackMarkdown, "text/markdown")}
              >
                <Download className="h-3 w-3" />
                Build pack
              </Button>
              <Button
                size="sm"
                className="ml-auto h-7 gap-1 text-xs"
                disabled={building}
                title="TIA must be open with the target project; Openness item edits are slow — a timeout does not mean failure"
                onClick={() => buildInTia(run.spec)}
              >
                {building ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hammer className="h-3 w-3" />}
                Build in TIA
              </Button>
            </>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {run && (
          <div className="grid min-h-0 grid-cols-2 gap-3">
            <div className="min-h-0">
              <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Build pack preview
              </p>
              <ScrollArea className="h-72 rounded-md border">
                <pre className="whitespace-pre-wrap p-2 font-mono text-[10px] leading-relaxed">
                  {run.buildPackMarkdown}
                </pre>
              </ScrollArea>
            </div>
            <div className="min-h-0 space-y-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  Summary
                </p>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">{run.ir.tags.length} tags</Badge>
                  <Badge variant="outline" className="text-[10px]">{run.ir.textLists.length} text lists</Badge>
                  <Badge variant="outline" className="text-[10px]">{run.ir.alarms.length} alarms</Badge>
                  <Badge variant="outline" className="text-[10px]">{run.ir.screens.length} screens</Badge>
                  <Badge variant="outline" className="text-[10px]">{run.ir.roles.length} roles</Badge>
                </div>
              </div>
              <div className="min-h-0">
                <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  Manual steps ({run.manualSteps.length})
                </p>
                <ScrollArea className="h-40 rounded-md border">
                  <ol className="list-decimal space-y-1 p-2 pl-6 text-[10px]">
                    {run.manualSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </ScrollArea>
              </div>
              {bridgeResult && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    Bridge result
                  </p>
                  <ScrollArea className="h-20 rounded-md border">
                    <pre
                      className={`whitespace-pre-wrap p-2 font-mono text-[10px] ${bridgeResult.ok ? "" : "text-destructive"}`}
                    >
                      {typeof bridgeResult.detail === "string"
                        ? bridgeResult.detail
                        : JSON.stringify(bridgeResult.detail, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
