import { useMutation } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

export function useOpenLocalFile() {
  return useMutation({
    mutationFn: async (localPath: string) => {
      const resp = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/fs/open-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (!resp) {
        throw new Error("bridge-unreachable");
      }
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message ?? "open-failed");
      }
    },
  });
}
