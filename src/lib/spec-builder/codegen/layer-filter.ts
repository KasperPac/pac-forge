import type { CodegenArtifact, CodegenLayer } from "./types";

/** Return only the artifacts produced by a given Phase-4 layer. Pure. */
export function filterByLayer(artifacts: CodegenArtifact[], layer: CodegenLayer): CodegenArtifact[] {
  return artifacts.filter((a) => a.layer === layer);
}
