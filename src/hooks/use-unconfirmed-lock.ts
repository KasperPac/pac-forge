import { useSpecContract } from "@/hooks/use-spec-contract";

/**
 * Shared lock-state hook for every spec-builder route. Returns whether the
 * loaded project is unconfirmed and the href to the migration wizard.
 *
 * Callers should:
 *   1. Render <UnconfirmedLockBanner /> at the top of the page if isUnconfirmed.
 *   2. Disable write controls (submit buttons, drag handles, etc.) while isUnconfirmed.
 */
export function useUnconfirmedLock(projectId: string, specProjectId: string) {
  const { data, isLoading, isError } = useSpecContract(specProjectId);
  return {
    isLoading,
    isError,
    isUnconfirmed: data?.confirmation_status === "unconfirmed",
    migrateHref: `/specs/${projectId}/${specProjectId}/migrate`,
  };
}
