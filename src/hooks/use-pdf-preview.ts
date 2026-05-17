import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "@/hooks/use-generation";

const DEBOUNCE_MS = 800;

interface UsePdfPreviewResult {
  url: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Calls the quote-render-pdf Edge Function in `dry_run` mode and exposes the
 * resulting PDF as a blob URL for an <iframe> preview. The hook debounces
 * snapshot changes by {@link DEBOUNCE_MS}ms, aborts in-flight requests when
 * the snapshot moves on, and revokes the prior blob URL on every replacement
 * and on unmount.
 *
 * Pass `null` to clear the preview.
 */
export function usePdfPreview(snapshot: unknown | null): UsePdfPreviewResult {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlobRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPdf = useCallback(async (snap: unknown) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-render-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ snapshot: snap, dry_run: true }),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `render failed (${res.status})`);
      }
      const blob = await res.blob();
      if (controller.signal.aborted) return;

      const blobUrl = URL.createObjectURL(blob);
      if (lastBlobRef.current) URL.revokeObjectURL(lastBlobRef.current);
      lastBlobRef.current = blobUrl;
      setUrl(blobUrl);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!snapshot) {
      if (lastBlobRef.current) {
        URL.revokeObjectURL(lastBlobRef.current);
        lastBlobRef.current = null;
      }
      setUrl(null);
      setError(null);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void fetchPdf(snapshot);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [snapshot, fetchPdf]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (lastBlobRef.current) {
        URL.revokeObjectURL(lastBlobRef.current);
        lastBlobRef.current = null;
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (snapshot) void fetchPdf(snapshot);
  }, [snapshot, fetchPdf]);

  return { url, isLoading, error, refresh };
}
