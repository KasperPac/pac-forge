import { Check, X, Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { PatternCandidate } from "@/types";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PatternReviewCardProps {
  pattern: PatternCandidate;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRevoke?: (id: string) => void;
  onDelete?: (id: string) => void;
  conflictWarning?: string;
}

const TYPE_COLORS: Record<string, string> = {
  NAMING: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  IO_MAPPING: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  STATE_LOGIC: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  ALARM: "bg-red-500/10 text-red-400 border-red-500/30",
  SAFETY: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  TIMING: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-400",
  APPROVED: "bg-green-500/10 text-green-400",
  REJECTED: "bg-neutral-500/10 text-neutral-400",
};

export function PatternReviewCard({ pattern, onApprove, onReject, onRevoke, onDelete, conflictWarning }: PatternReviewCardProps) {
  const typeClass = TYPE_COLORS[pattern.correction_type] ?? "";
  const statusClass = STATUS_STYLES[pattern.status] ?? "";
  const isPending = pattern.status === "PENDING";
  const isApproved = pattern.status === "APPROVED";
  const isRejected = pattern.status === "REJECTED";

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`font-mono text-[9px] ${typeClass}`}>
            {pattern.correction_type}
          </Badge>
          <Badge variant="outline" className={`font-mono text-[9px] ${statusClass}`}>
            {pattern.status}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            {pattern.device_type}
          </span>
          {conflictWarning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-0.5 border-amber-500/30 font-mono text-[9px] text-amber-400">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Conflict
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-mono text-xs">{conflictWarning}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">
          {new Date(pattern.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Explanation */}
      <div className="border-b px-4 py-2">
        <div className="text-xs text-muted-foreground">{pattern.explanation_tag}</div>
      </div>

      {/* Snippets */}
      <div className="grid grid-cols-2 divide-x">
        <div className="p-3">
          <div className="mb-1 font-mono text-[9px] text-muted-foreground">ORIGINAL</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-red-500/5 p-2 font-mono text-[10px] text-red-300">
            {pattern.original_snippet}
          </pre>
        </div>
        <div className="p-3">
          <div className="mb-1 font-mono text-[9px] text-muted-foreground">CORRECTED</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-green-500/5 p-2 font-mono text-[10px] text-green-300">
            {pattern.corrected_snippet}
          </pre>
        </div>
      </div>

      {/* Context */}
      {pattern.context && (
        <div className="border-t px-4 py-2">
          <div className="font-mono text-[9px] text-muted-foreground">
            Context: {pattern.context}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between border-t px-4 py-2">
        <div className="flex items-center gap-2">
          {isApproved && (
            <span className="font-mono text-[10px] text-green-400">
              Active — injected into all generation prompts
            </span>
          )}
          {isRejected && (
            <span className="font-mono text-[10px] text-muted-foreground">
              Rejected — not used in generation
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 font-mono text-[10px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete pattern permanently?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this correction pattern. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(pattern.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {(isApproved || isRejected) && onRevoke && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 font-mono text-[10px] text-amber-400 hover:text-amber-300"
              onClick={() => onRevoke(pattern.id)}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Revoke
            </Button>
          )}
          {isPending && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 font-mono text-[10px] text-red-400 hover:text-red-300"
                onClick={() => onReject(pattern.id)}
              >
                <X className="mr-1 h-3 w-3" />
                Reject
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 font-mono text-[10px] text-green-400 hover:text-green-300"
                onClick={() => onApprove(pattern.id)}
              >
                <Check className="mr-1 h-3 w-3" />
                Approve
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
