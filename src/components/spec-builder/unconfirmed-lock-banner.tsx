import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  migrateHref: string;
}

export function UnconfirmedLockBanner({ migrateHref }: Props) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 border-b border-amber-300 bg-amber-50 text-amber-900"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <p className="text-sm flex-1">
        This project is on the <strong>V1 schema</strong>. Edits are disabled until you migrate to V2.
      </p>
      <Button asChild size="sm" variant="default">
        <Link to={migrateHref}>Migrate to V2</Link>
      </Button>
    </div>
  );
}
