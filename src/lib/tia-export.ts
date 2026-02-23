import JSZip from "jszip";
import type { Artifact, TiaManifest } from "@/types";

/**
 * Generate a downloadable zip bundle containing all artifacts and the TIA manifest.
 * This is Mode A (offline export) — the engineer manually imports into TIA Portal.
 */
export async function generateExportBundle(
  artifacts: Artifact[],
  manifest: TiaManifest
): Promise<Blob> {
  const zip = new JSZip();

  // Add each artifact file
  for (const artifact of artifacts) {
    // Use approved_content if available, otherwise generated content
    const content = artifact.approved_content ?? artifact.content;
    zip.file(artifact.filename, content);
  }

  // Add the manifest
  zip.file("tia_manifest.json", JSON.stringify(manifest, null, 2));

  // Generate the zip
  return zip.generateAsync({ type: "blob" });
}

/**
 * Trigger a browser download of the export bundle.
 */
export async function downloadExportBundle(
  artifacts: Artifact[],
  manifest: TiaManifest,
  projectName: string
): Promise<void> {
  const blob = await generateExportBundle(artifacts, manifest);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${projectName.replace(/[^a-zA-Z0-9-_]/g, "_")}_${timestamp}.zip`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
