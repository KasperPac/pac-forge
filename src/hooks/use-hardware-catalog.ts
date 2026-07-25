/**
 * useHardwareCatalog — search TIA's installed hardware catalogue via the bridge
 * so the Hardware step can offer real parts instead of hand-typed MLFBs (G0-17).
 *
 * Degrades to "unavailable" rather than erroring: the FDS must stay authorable
 * with no TIA running, so the picker is an accelerator over the free-text
 * fields, never a gate.
 */
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { HardwareCatalogResponse } from "@/lib/tia-bridge-contract";
import { groupCatalogEntries, type CatalogProduct } from "@/lib/spec-builder/hardware-catalog";

/** Below this, a search matches most of the catalogue and is not worth sending. */
export const MIN_FILTER_LENGTH = 3;

async function fetchCatalog(
  filter: string,
  typeIdentifier?: string,
): Promise<HardwareCatalogResponse> {
  const params = new URLSearchParams({ filter });
  if (typeIdentifier) params.set("typeIdentifier", typeIdentifier);

  const response = await fetch(
    `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/hardware-catalog?${params.toString()}`,
    // The catalogue lives in TIA's process; a cold first query can take a while.
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok) {
    throw new Error(`Hardware catalogue lookup failed (${response.status})`);
  }
  return (await response.json()) as HardwareCatalogResponse;
}

export function useHardwareCatalog(filter: string, typeIdentifier?: string) {
  const trimmed = filter.trim();
  const enabled = trimmed.length >= MIN_FILTER_LENGTH;

  const query = useQuery({
    queryKey: ["tia-hardware-catalog", trimmed, typeIdentifier ?? ""],
    queryFn: () => fetchCatalog(trimmed, typeIdentifier),
    enabled,
    // The installed catalogue does not change while the app is open.
    staleTime: Infinity,
    // Bridge offline is the normal case when authoring away from TIA — fail
    // fast and let the caller fall back to free text rather than retrying.
    retry: false,
  });

  const products: CatalogProduct[] = query.data?.entries
    ? groupCatalogEntries(query.data.entries)
    : [];

  return {
    products,
    /** True once a search ran and the bridge could not be reached. */
    unavailable: enabled && query.isError,
    searching: enabled && query.isFetching,
    enabled,
  };
}
