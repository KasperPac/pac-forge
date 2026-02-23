import type { Artifact, TiaManifest, ManifestArtifact } from "@/types";

/** Priority order for artifact types — lower number = imported first */
const TYPE_PRIORITY: Record<string, number> = {
  UDT: 0,
  TAG_TABLE: 1,
  FB: 2,
  FC: 3,
  DB: 4,
  OB: 5,
  SCL_SOURCE: 6,
};

/** Default destination folders by artifact type */
const DESTINATION_FOLDERS: Record<string, string> = {
  UDT: "Types",
  TAG_TABLE: "PLC tags",
  FB: "Program blocks/Pac-ST",
  FC: "Program blocks/Pac-ST",
  DB: "Program blocks/Pac-ST",
  OB: "Program blocks",
  SCL_SOURCE: "External source files",
};

export interface ManifestBuildResult {
  manifest: TiaManifest;
  errors: string[];
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns sorted artifact names or null if a cycle is detected.
 */
function topologicalSort(
  artifacts: Artifact[]
): { sorted: string[]; cycle: boolean } {
  const nameToArtifact = new Map(artifacts.map((a) => [a.name, a]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const a of artifacts) {
    inDegree.set(a.name, 0);
    adjacency.set(a.name, []);
  }

  // Build edges: dep → artifact (dep must come before artifact)
  for (const a of artifacts) {
    for (const dep of a.dependencies) {
      if (nameToArtifact.has(dep)) {
        adjacency.get(dep)!.push(a.name);
        inDegree.set(a.name, (inDegree.get(a.name) ?? 0) + 1);
      }
    }
  }

  // Start with nodes that have no dependencies
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  // Sort ties by type priority, then alphabetically
  queue.sort((a, b) => {
    const aType = nameToArtifact.get(a)!.type;
    const bType = nameToArtifact.get(b)!.type;
    const aPri = TYPE_PRIORITY[aType] ?? 99;
    const bPri = TYPE_PRIORITY[bType] ?? 99;
    if (aPri !== bPri) return aPri - bPri;
    return a.localeCompare(b);
  });

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
        // Re-sort to maintain priority ordering among new candidates
        queue.sort((a, b) => {
          const aType = nameToArtifact.get(a)!.type;
          const bType = nameToArtifact.get(b)!.type;
          const aPri = TYPE_PRIORITY[aType] ?? 99;
          const bPri = TYPE_PRIORITY[bType] ?? 99;
          if (aPri !== bPri) return aPri - bPri;
          return a.localeCompare(b);
        });
      }
    }
  }

  return { sorted, cycle: sorted.length !== artifacts.length };
}

/**
 * Build a TIA manifest from a set of artifacts and project metadata.
 */
export function buildManifest(
  artifacts: Artifact[],
  meta: {
    projectId: string;
    tiaVersion: string;
    cpuType: string;
    userId: string;
    sessionId: string;
  }
): ManifestBuildResult {
  const errors: string[] = [];

  // Validate all dependencies exist
  const nameSet = new Set(artifacts.map((a) => a.name));
  for (const a of artifacts) {
    for (const dep of a.dependencies) {
      if (!nameSet.has(dep)) {
        errors.push(`"${a.name}" depends on "${dep}" which is missing from the bundle`);
      }
    }
  }

  // Topological sort
  const { sorted, cycle } = topologicalSort(artifacts);
  if (cycle) {
    errors.push("Circular dependency detected in artifacts");
  }

  // Build ordered manifest artifacts
  const nameToArtifact = new Map(artifacts.map((a) => [a.name, a]));
  const orderedArtifacts: ManifestArtifact[] = sorted.map((name) => {
    const a = nameToArtifact.get(name)!;
    return {
      name: a.name,
      type: a.type,
      filename: a.filename,
      destination_folder: a.destination_folder || DESTINATION_FOLDERS[a.type] || "Program blocks",
      dependencies: a.dependencies,
      compile_after_import: a.compile_after_import,
      overwrite_strategy: a.overwrite_strategy,
      notes: a.notes || undefined,
    };
  });

  // Add any artifacts not in the sorted list (if cycle was detected, still include them)
  if (cycle) {
    for (const a of artifacts) {
      if (!sorted.includes(a.name)) {
        orderedArtifacts.push({
          name: a.name,
          type: a.type,
          filename: a.filename,
          destination_folder: a.destination_folder || DESTINATION_FOLDERS[a.type] || "Program blocks",
          dependencies: a.dependencies,
          compile_after_import: a.compile_after_import,
          overwrite_strategy: a.overwrite_strategy,
          notes: a.notes || undefined,
        });
      }
    }
  }

  const manifest: TiaManifest = {
    manifest_version: "1.0",
    project_id: meta.projectId,
    platform: "SIEMENS_TIA",
    tia_version: meta.tiaVersion,
    cpu_type: meta.cpuType,
    created_at: new Date().toISOString(),
    created_by_user_id: meta.userId,
    generation_session_id: meta.sessionId,
    artifacts: orderedArtifacts,
  };

  return { manifest, errors };
}
