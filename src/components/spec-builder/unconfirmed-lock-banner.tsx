import { AlertTriangle } from "lucide-react";

export function UnconfirmedLockBanner() {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 border-b border-amber-300 bg-amber-50 text-amber-900"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <p className="text-sm flex-1">
        This project is <strong>unconfirmed</strong>. Edits are disabled until the
        spec is confirmed.
      </p>
    </div>
  );
}
