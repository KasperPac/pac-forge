/**
 * Shared status helpers for spec-builder phase launch cards.
 *
 * Computes short human-readable status strings for Phases 3/4/5 so the
 * spec-builder dashboard and the dedicated full-screen routes stay in sync.
 */
import type { SpecProject, SpecSection, SpecExport } from "@/types/spec-builder";
import type { OperationSession } from "@/types/spec-builder";

export function computeCoAuthorStatus(
  spec: SpecProject,
  sessions: OperationSession[] | undefined,
): string {
  const totalAssemblies = spec.confirmed_units.reduce(
    (n, s) => n + (s.equipment_modules?.length ?? 0),
    0,
  );
  if (totalAssemblies === 0) return "No equipment_modules defined yet";
  const completed =
    sessions?.filter((s) => s.status === "complete").length ?? 0;
  return `${completed} of ${totalAssemblies} equipment_modules complete`;
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
