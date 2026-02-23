import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { BridgeEvent, BridgeEventType } from "@/lib/tia-bridge-contract";

interface UseTiaBridgeWsOptions {
  enabled: boolean;
  jobId?: string | null;
  onEvent?: (event: BridgeEvent) => void;
}

interface UseTiaBridgeWsReturn {
  connected: boolean;
  lastEvent: BridgeEvent | null;
  progress: number;
  currentStep: string;
}

export function useTiaBridgeWs({
  enabled,
  jobId,
  onEvent,
}: UseTiaBridgeWsOptions): UseTiaBridgeWsReturn {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<BridgeEvent | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");

  const invalidateJobs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["tia-jobs"] });
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) {
      // Clean up if disabled
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setConnected(false);
      return;
    }

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(DEFAULT_BRIDGE_CONFIG.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as BridgeEvent;

          // Filter by jobId if provided
          if (jobId && parsed.job_id && parsed.job_id !== jobId) return;

          setLastEvent(parsed);

          // Update progress for progress events
          if (parsed.type === "job_progress") {
            const data = parsed.data as { progress?: number; current_step?: string };
            if (typeof data.progress === "number") setProgress(data.progress);
            if (typeof data.current_step === "string") setCurrentStep(data.current_step);
          }

          // Invalidate query cache on terminal events
          const terminalEvents: BridgeEventType[] = ["job_completed", "job_failed"];
          if (terminalEvents.includes(parsed.type)) {
            invalidateJobs();
          }

          onEventRef.current?.(parsed);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff: 1s, 2s, 4s, max 10s
        if (enabled) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
          retryCountRef.current++;
          retryTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling reconnection
        ws.close();
      };
    }

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [enabled, jobId, invalidateJobs]);

  return { connected, lastEvent, progress, currentStep };
}
