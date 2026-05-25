import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  canConfirm: boolean;          // true when all three tabs report tabComplete
  isPending: boolean;
  errorMessages: string[];       // shown above the button if non-empty
  onConfirm: () => void;
}

export function MigrateConfirmBar({ canConfirm, isPending, errorMessages, onConfirm }: Props) {
  return (
    <div className="sticky bottom-0 border-t bg-background z-10">
      {errorMessages.length > 0 && (
        <Card className="m-3 p-3 bg-red-50 border-red-200 text-sm text-red-900">
          <ul className="list-disc pl-5">
            {errorMessages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Confirming writes the new structured shape to the spec project and unlocks edits on every spec-builder route.
        </p>
        <Button
          onClick={onConfirm}
          disabled={!canConfirm || isPending}
          size="lg"
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Confirm Migration
        </Button>
      </div>
    </div>
  );
}
