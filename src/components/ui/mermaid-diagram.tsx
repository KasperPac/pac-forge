import { useEffect, useRef, useState, useId } from "react";
import mermaid from "mermaid";
import { cn } from "@/lib/utils";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      darkMode: true,
      primaryColor: "#3b82f6",
      primaryTextColor: "#e5e7eb",
      primaryBorderColor: "#4b5563",
      lineColor: "#6b7280",
      secondaryColor: "#1e293b",
      tertiaryColor: "#1e293b",
      // Do NOT use monospace here — Mermaid measures node widths via canvas
      // and monospace causes systematic under-measurement, clipping text inside boxes.
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "12px",
    },
  });
}

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId().replace(/:/g, "_");

  useEffect(() => {
    if (!chart.trim() || !containerRef.current) {
      if (containerRef.current) containerRef.current.innerHTML = "";
      setError(null);
      return;
    }

    ensureInit();

    let cancelled = false;

    (async () => {
      try {
        const { svg } = await mermaid.render(`mermaid_${uniqueId}`, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          if (containerRef.current) containerRef.current.innerHTML = "";
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, uniqueId]);

  if (!chart.trim()) {
    return (
      <div className={cn("flex items-center justify-center rounded-md border border-dashed border-border/50 p-4", className)}>
        <span className="font-mono text-xs text-muted-foreground/60">No sequence defined</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-md border border-destructive/30 bg-destructive/5 p-3", className)}>
        <div className="font-mono text-[10px] font-medium text-destructive">Diagram Error</div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">{error}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-visible [&_svg]:h-auto", className)}
    />
  );
}
