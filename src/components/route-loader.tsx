import { Loader2 } from "lucide-react";

export function RouteLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-mono text-xs">Loading...</span>
      </div>
    </div>
  );
}
