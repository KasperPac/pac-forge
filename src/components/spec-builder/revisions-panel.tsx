/**
 * Right-docked Sheet listing spec revisions for a project with per-status
 * actions: submit draft, approve/reject submitted, revert approved/revised.
 */
import { useState } from "react";
import {
  ArrowLeftCircle,
  CheckCircle2,
  Download,
  FileText,
  History,
  Loader2,
  Send,
  ShieldCheck,
  ThumbsDown,
  Upload,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useApproveRevision,
  useCreateDraft,
  useRejectRevision,
  useRevertRevision,
  useRevisions,
  useSubmitDraft,
  type SpecRevision,
  type SpecRevisionStatus,
} from "@/hooks/use-spec-revisions";
import { useSpecProject } from "@/hooks/use-spec-projects";

export interface RevisionsPanelProps {
  specProjectId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_STYLES: Record<SpecRevisionStatus, string> = {
  draft: "bg-muted text-muted-foreground border-muted",
  submitted: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  approved: "bg-green-500/10 text-green-400 border-green-500/30",
  revised: "bg-red-500/10 text-red-400 border-red-500/30",
};

const SOURCE_ICONS: Record<SpecRevision["source"], typeof FileText> = {
  authored: FileText,
  markup: Upload,
  foreign_ingest: Upload,
};

export function RevisionsPanel({
  specProjectId,
  open,
  onOpenChange,
}: RevisionsPanelProps) {
  const { data: revisions = [], isLoading } = useRevisions(specProjectId);
  const { data: specProject } = useSpecProject(specProjectId);
  const createDraft = useCreateDraft();

  const latestApprovedId =
    (specProject as unknown as { latest_approved_revision_id?: string | null })
      ?.latest_approved_revision_id ?? null;

  const handleCreateDraft = () => {
    if (!specProjectId) return;
    createDraft.mutate(specProjectId);
  };

  const hasDraft = revisions.some((r) => r.status === "draft");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Revisions
          </SheetTitle>
          <SheetDescription className="text-xs">
            Draft → Submitted → Approved, with letter-suffix labels
            (<span className="font-mono">01A</span>, <span className="font-mono">01B</span>, <span className="font-mono">02A</span>).
          </SheetDescription>
        </SheetHeader>

        <div className="p-3 border-b">
          <Button
            className="w-full"
            size="sm"
            variant="outline"
            disabled={!specProjectId || hasDraft || createDraft.isPending}
            onClick={handleCreateDraft}
          >
            {createDraft.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-1" />
            )}
            {hasDraft ? "Draft in progress" : "Start new draft"}
          </Button>
        </div>

        <ScrollArea className="flex-1 h-[calc(100vh-160px)]">
          <div className="p-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading revisions…
              </div>
            ) : revisions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center p-6">
                No revisions yet.
              </p>
            ) : (
              revisions.map((rev) => (
                <RevisionRow
                  key={rev.id}
                  rev={rev}
                  isLatestApproved={rev.id === latestApprovedId}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function RevisionRow({
  rev,
  isLatestApproved,
}: {
  rev: SpecRevision;
  isLatestApproved: boolean;
}) {
  const SourceIcon = SOURCE_ICONS[rev.source] ?? FileText;
  const [notesOpen, setNotesOpen] = useState<"submit" | "reject" | null>(null);
  const [notesDraft, setNotesDraft] = useState("");

  const submit = useSubmitDraft();
  const approve = useApproveRevision();
  const reject = useRejectRevision();
  const revert = useRevertRevision();

  const closeNotes = () => {
    setNotesOpen(null);
    setNotesDraft("");
  };

  const onSubmitDraft = async () => {
    await submit.mutateAsync({ revisionId: rev.id, notes: notesDraft || null });
    closeNotes();
  };

  const onReject = async () => {
    await reject.mutateAsync({
      revisionId: rev.id,
      notes: notesDraft || "(rejected)",
    });
    closeNotes();
  };

  const busy =
    submit.isPending ||
    approve.isPending ||
    reject.isPending ||
    revert.isPending;

  return (
    <Card
      className={cn(
        "p-3 space-y-2",
        isLatestApproved && "border-green-500/50 bg-green-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-mono font-semibold">
              {rev.display_label}
            </span>
            <Badge
              variant="outline"
              className={cn("text-[10px] uppercase", STATUS_STYLES[rev.status])}
            >
              {rev.status}
            </Badge>
            {isLatestApproved && (
              <Badge
                variant="outline"
                className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30"
              >
                <ShieldCheck className="h-3 w-3 mr-0.5" />
                Active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
            <SourceIcon className="h-3 w-3" />
            <span className="capitalize">{rev.source.replace("_", " ")}</span>
            <span>·</span>
            <span>{formatRelative(rev.created_at)}</span>
          </div>
        </div>
      </div>

      {rev.notes && (
        <p className="text-xs text-muted-foreground italic line-clamp-2">
          {rev.notes}
        </p>
      )}

      {notesOpen && (
        <div className="space-y-2">
          <Textarea
            placeholder={
              notesOpen === "submit"
                ? "Submission notes (optional)…"
                : "Why is this revision being rejected?"
            }
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            className="text-xs h-20"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={closeNotes}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={notesOpen === "submit" ? onSubmitDraft : onReject}
              disabled={busy}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}

      {!notesOpen && (
        <>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {rev.status === "draft" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNotesOpen("submit")}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Submit for approval
              </Button>
            )}
            {rev.status === "submitted" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approve.mutate(rev.id)}
                  disabled={busy}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNotesOpen("reject")}
                  disabled={busy}
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
              </>
            )}
            {(rev.status === "approved" || rev.status === "revised") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => revert.mutate(rev.id)}
                disabled={busy}
              >
                <ArrowLeftCircle className="h-3.5 w-3.5 mr-1" />
                Revert to this
              </Button>
            )}
            {rev.docx_storage_path && (
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={rev.docx_storage_path}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  DOCX
                </a>
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const delta = Date.now() - then;
  const mins = Math.round(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
