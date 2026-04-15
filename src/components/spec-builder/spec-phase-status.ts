/**
 * Shared status helpers for spec-builder phase launch cards.
 *
 * Computes short human-readable status strings for Phases 3/4/5 so the
 * spec-builder dashboard and the dedicated full-screen routes stay in sync.
 */
import type { SpecProject, SpecSection, SpecExport } from "@/types/spec-builder";
import type { FdsAssemblySession } from "@/types/spec-builder";

export function computeCoAuthorStatus(
  spec: SpecProject,
  sessions: FdsAssemblySession[] | undefined,
): string {
  const totalAssemblies = spec.confirmed_subsystems.reduce(
    (n, s) => n + (s.assemblies?.length ?? 0),
    0,
  );
  if (totalAssemblies === 0) return "No assemblies defined yet";
  const completed =
    sessions?.filter((s) => s.status === "complete").length ?? 0;
  return `${completed} of ${totalAssemblies} assemblies complete`;
}

export function computeEditorStatus(sections: SpecSection[] | undefined): string {
  const total = sections?.length ?? 0;
  if (total === 0) return "No sections generated yet";
  const approved = sections?.filter((s) => s.approved).length ?? 0;
  return `${approved} of ${total} sections approved`;
}

export function computeExportStatus(exports: SpecExport[] | undefined): string {
  if (!exports || exports.length === 0) return "Not exported yet";
  const most = exports
    .slice()
    .sort(
      (a, b) =>
        new Date(b.exported_at).getTime() - new Date(a.exported_at).getTime(),
    )[0];
  return `Last export: ${new Date(most.exported_at).toLocaleDateString()} (Rev ${most.revision})`;
}
