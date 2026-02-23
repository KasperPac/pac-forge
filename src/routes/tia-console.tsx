import { useState } from "react";
import { Terminal, Wifi, WifiOff, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTiaJobs, useBridgeStatus } from "@/hooks/use-tia-jobs";
import type { TiaJob } from "@/types";

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  PENDING: { className: "bg-amber-500/10 text-amber-400 border-amber-500/30", label: "Pending" },
  RUNNING: { className: "bg-blue-500/10 text-blue-400 border-blue-500/30", label: "Running" },
  COMPLETED: { className: "bg-green-500/10 text-green-400 border-green-500/30", label: "Completed" },
  FAILED: { className: "bg-red-500/10 text-red-400 border-red-500/30", label: "Failed" },
  CANCELLED: { className: "bg-neutral-500/10 text-neutral-400 border-neutral-500/30", label: "Cancelled" },
};

function JobDetailRow({ job }: { job: TiaJob }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_STYLES[job.status] ?? STATUS_STYLES.PENDING;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="w-8">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-mono text-[10px]">{job.job_type}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`font-mono text-[9px] ${status.className}`}>
            {status.label}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-[10px]">
          {job.manifest.artifacts.length}
        </TableCell>
        <TableCell className="font-mono text-[10px] text-muted-foreground">
          {new Date(job.created_at).toLocaleString()}
        </TableCell>
        <TableCell className="font-mono text-[10px] text-muted-foreground">
          {job.completed_at
            ? new Date(job.completed_at).toLocaleString()
            : "—"}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-0">
            <div className="space-y-2 px-6 py-3">
              {/* Manifest artifacts */}
              <div>
                <div className="mb-1 font-mono text-[9px] text-muted-foreground">
                  ARTIFACTS (import order)
                </div>
                <div className="space-y-0.5">
                  {job.manifest.artifacts.map((a, i) => (
                    <div key={a.name} className="flex items-center gap-2">
                      <span className="w-4 text-right font-mono text-[8px] text-muted-foreground">
                        {i + 1}.
                      </span>
                      <Badge variant="outline" className="px-1 py-0 font-mono text-[8px]">
                        {a.type}
                      </Badge>
                      <span className="font-mono text-[10px]">{a.name}</span>
                      {a.dependencies.length > 0 && (
                        <span className="font-mono text-[8px] text-muted-foreground">
                          → {a.dependencies.join(", ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Compile results */}
              {job.compile_results && (
                <div>
                  <div className="mb-1 font-mono text-[9px] text-muted-foreground">
                    COMPILE RESULTS
                  </div>
                  {job.compile_results.success ? (
                    <div className="font-mono text-[10px] text-green-400">
                      Compilation successful
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {job.compile_results.errors.map((err, i) => (
                        <div key={i} className="font-mono text-[10px] text-red-400">
                          {err.artifact_name}
                          {err.line ? `:${err.line}` : ""} — {err.error_text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function TiaConsolePage() {
  const { data: bridgeStatus } = useBridgeStatus();
  // Show all jobs — no project filter for the console view
  const { data: jobs, isLoading } = useTiaJobs(undefined);

  const isConnected = bridgeStatus?.connected ?? false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-muted-foreground">TIA PORTAL</div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Terminal className="h-5 w-5" />
            TIA Console
          </h1>
        </div>

        {/* Bridge status */}
        <Card className="px-3 py-2">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <Wifi className="h-4 w-4 text-green-400" />
                <div>
                  <div className="font-mono text-[10px] text-green-400">Bridge Online</div>
                  {bridgeStatus?.version && (
                    <div className="font-mono text-[8px] text-muted-foreground">
                      v{bridgeStatus.version}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-mono text-[10px] text-muted-foreground">Bridge Offline</div>
                  <div className="font-mono text-[8px] text-muted-foreground">
                    Start the TIA Bridge to connect
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Separator />

      {/* Job history */}
      {isLoading && (
        <div className="py-8 text-center font-mono text-sm text-muted-foreground">
          Loading jobs...
        </div>
      )}

      {!isLoading && (!jobs || jobs.length === 0) && (
        <Card className="p-6">
          <p className="font-mono text-sm text-muted-foreground">
            No TIA jobs yet. Generate and export artifacts from Pac-ST to create jobs.
          </p>
        </Card>
      )}

      {jobs && jobs.length > 0 && (
        <ScrollArea className="h-[calc(100vh-14rem)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="font-mono text-[10px]">Type</TableHead>
                <TableHead className="font-mono text-[10px]">Status</TableHead>
                <TableHead className="font-mono text-[10px]">Artifacts</TableHead>
                <TableHead className="font-mono text-[10px]">Created</TableHead>
                <TableHead className="font-mono text-[10px]">Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <JobDetailRow key={job.id} job={job as TiaJob} />
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
}
