import type { ArtifactType } from "@/types";

/**
 * Parsed artifact extracted from Claude's response.
 * These are not yet full Artifact objects (no id, project_id, etc.) —
 * the caller adds those before saving to DB.
 */
export interface ParsedArtifact {
  name: string;
  type: ArtifactType;
  filename: string;
  content: string;
  dependencies: string[];
  folder?: string;
}

const VALID_TYPES = new Set(["UDT", "FB", "FC", "DB", "OB", "SCL_SOURCE", "TAG_TABLE"]);

/**
 * Regex to match artifact blocks in Claude's response.
 *
 * Format:
 * ```scl filename="<path>" type="<TYPE>" name="<Name>" dependencies="<dep1, dep2>"
 * <content>
 * ```
 *
 * All attributes after `scl` are key="value" pairs. `dependencies` may be empty.
 */
const ARTIFACT_BLOCK_REGEX =
  /```scl\s+((?:[a-z_]+=(?:"[^"]*"|'[^']*')\s*)+)\n([\s\S]*?)```/g;

const ATTR_REGEX = /([a-z_]+)=(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTR_REGEX.lastIndex = 0;
  while ((match = ATTR_REGEX.exec(attrString)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? "";
  }
  return attrs;
}

export interface ParseResult {
  artifacts: ParsedArtifact[];
  summary: string;
  errors: string[];
}

/**
 * Parse Claude's full response text into individual artifacts.
 */
export function parseArtifacts(responseText: string): ParseResult {
  const artifacts: ParsedArtifact[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();

  // Extract all artifact blocks
  let match: RegExpExecArray | null;
  ARTIFACT_BLOCK_REGEX.lastIndex = 0;
  let lastBlockEnd = 0;

  while ((match = ARTIFACT_BLOCK_REGEX.exec(responseText)) !== null) {
    const attrs = parseAttributes(match[1]);
    const content = match[2].trimEnd();
    lastBlockEnd = match.index + match[0].length;

    const name = attrs.name;
    const type = attrs.type;
    const filename = attrs.filename;
    const depsRaw = attrs.dependencies ?? "";

    // Validate required fields
    if (!name) {
      errors.push(`Artifact block missing "name" attribute`);
      continue;
    }
    if (!type || !VALID_TYPES.has(type)) {
      errors.push(`Artifact "${name}" has invalid type: "${type}"`);
      continue;
    }
    if (!filename) {
      errors.push(`Artifact "${name}" missing "filename" attribute`);
      continue;
    }
    if (seenNames.has(name)) {
      errors.push(`Duplicate artifact name: "${name}"`);
      continue;
    }

    seenNames.add(name);

    const dependencies = depsRaw
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    artifacts.push({
      name,
      type: type as ArtifactType,
      filename,
      content,
      dependencies,
      folder: attrs.folder || undefined,
    });
  }

  // Validate dependency references
  for (const artifact of artifacts) {
    for (const dep of artifact.dependencies) {
      if (!seenNames.has(dep)) {
        errors.push(
          `Artifact "${artifact.name}" depends on "${dep}" which is not in the bundle`
        );
      }
    }
  }

  // Extract summary text — anything after the last artifact block
  let summary = "";
  if (lastBlockEnd > 0) {
    summary = responseText.slice(lastBlockEnd).trim();
  } else if (artifacts.length === 0) {
    // No artifacts found — the whole response is the summary
    summary = responseText.trim();
  }

  return { artifacts, summary, errors };
}
