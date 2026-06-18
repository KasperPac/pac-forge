import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface UploadResult {
  file: File;
  filename: string;       // final name (auto-numbered or original)
  markCustomer: boolean;  // record an exemption override after upload
}

export function UploadDocDialog({
  open,
  onOpenChange,
  computeNumberedName,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Given a picked file, return the auto-numbered name for a Pac doc. */
  computeNumberedName: (file: File) => string;
  onConfirm: (r: UploadResult) => void;
  busy: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);

  const numberedName = file ? computeNumberedName(file) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Upload document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 font-mono text-xs">
          <input
            type="file"
            className="block w-full text-xs"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <div className="rounded-md border border-border p-2 text-foreground">
              Pac-controlled name: {numberedName}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!file || busy}
            onClick={() =>
              file && onConfirm({ file, filename: file.name, markCustomer: true })
            }
          >
            Upload as customer-supplied
          </Button>
          <Button
            size="sm"
            disabled={!file || busy}
            onClick={() =>
              file && onConfirm({ file, filename: numberedName, markCustomer: false })
            }
          >
            Upload as Pac-controlled
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
