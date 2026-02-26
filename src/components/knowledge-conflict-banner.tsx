import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface KnowledgeConflictBannerProps {
  unresolvedCount: number;
  onReview: () => void;
}

export function KnowledgeConflictBanner({
  unresolvedCount,
  onReview,
}: KnowledgeConflictBannerProps) {
  if (unresolvedCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      <span className="font-mono text-xs text-amber-300">
        {unresolvedCount} knowledge conflict{unresolvedCount !== 1 ? "s" : ""} detected
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-6 border-amber-500/30 px-2 font-mono text-xs text-amber-400 hover:bg-amber-500/10"
        onClick={onReview}
      >
        Review Conflicts
      </Button>
    </div>
  );
}
