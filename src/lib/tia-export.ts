import JSZip from "jszip";
import type { Artifact, TiaManifest } from "@/types";
import { buildArtifactXml, toXmlFilename } from "@/lib/simatic-xml-builder";

export type ExportFormat = "scl" | "xml" | "both";

export interface ExportOptions {
  format: ExportFormat;
}

/**
 * Generate a downloadable zip bundle containing all artifacts and the TIA manifest.
 * This is Mode A (offline export) — the engineer manually imports into TIA Portal.
 *
 * @param format - "scl" for SCL-only, "xml" for SimaticML XML-only, "both" for both
 */
export async function generateExportBundle(
  artifacts: Artifact[],
  manifest: TiaManifest,
  options: ExportOptions = { format: "both" }
): Promise<Blob> {
  const zip = new JSZip();
  const { format } = options;
  const tiaVersion = manifest.tia_version;

  for (const artifact of artifacts) {
    const content = artifact.approved_content ?? artifact.content;

    // Add SCL file
    if (format === "scl" || format === "both") {
      zip.file(artifact.filename, content);
    }

    // Add XML file (if the artifact type supports it)
    if (format === "xml" || format === "both") {
      const xml = buildArtifactXml(artifact, tiaVersion);
      if (xml) {
        zip.file(toXmlFilename(artifact.filename), xml);
      } else if (format === "xml") {
        // For types without XML support (SCL_SOURCE, TAG_TABLE),
        // fall back to including the raw SCL file
        zip.file(artifact.filename, content);
      }
    }
  }

  // Add the manifest
  zip.file("tia_manifest.json", JSON.stringify(manifest, null, 2));

  return zip.generateAsync({ type: "blob" });
}

/**
 * Trigger a browser download of the export bundle.
 */
export async function downloadExportBundle(
  artifacts: Artifact[],
  manifest: TiaManifest,
  projectName: string,
  options: ExportOptions = { format: "both" }
): Promise<void> {
  const blob = await generateExportBundle(artifacts, manifest, options);

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
