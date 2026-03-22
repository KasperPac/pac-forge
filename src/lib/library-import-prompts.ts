/**
 * Prompt builders for the Library Import flow.
 *
 * Extracts all callable blocks (FB / FC) from a TIA Portal library document
 * and returns structured JSON suitable for creating FB library entries.
 */

export function buildLibraryExtractSystemPrompt(): string {
  return `You are a Siemens TIA Portal expert extracting function block and function interfaces from library documentation.

Your task: read the provided document text and find EVERY callable block described — Function Blocks (FB) and Functions (FC).

For each block extract:
- name: exact block name as it would appear in TIA Portal (e.g. "LGF_ScaleValue", "LCOM_Connect")
- block_type: "FB" if it has internal state / instance data, "FC" if it is purely computational with no persistent state
- description: one or two sentence description of what it does
- inputs: all VAR_INPUT parameters — name, data_type, description
- outputs: all VAR_OUTPUT parameters — name, data_type, description
- in_out: all VAR_IN_OUT parameters — name, data_type, description (empty array if none)
- tags: 2-5 keywords describing what domain/function this covers (e.g. ["scaling", "analog", "math"])

Rules:
- Include EVERY block you find — do not skip any
- If a parameter type is unclear, use the closest S7-1500 SCL type (BOOL, INT, DINT, REAL, WORD, etc.)
- If a description is not given for a parameter, leave description as ""
- Do NOT include implementation details — interfaces only
- Output ONLY a JSON array, no markdown fences, no explanation

Output format:
[
  {
    "name": "LGF_ScaleValue",
    "block_type": "FC",
    "description": "Scales a raw value from one range to another using linear interpolation.",
    "inputs": [
      { "name": "rawValue", "data_type": "REAL", "description": "Input value to scale" },
      { "name": "rawMin",   "data_type": "REAL", "description": "Minimum of input range" },
      { "name": "rawMax",   "data_type": "REAL", "description": "Maximum of input range" },
      { "name": "engMin",   "data_type": "REAL", "description": "Minimum of output range" },
      { "name": "engMax",   "data_type": "REAL", "description": "Maximum of output range" }
    ],
    "outputs": [
      { "name": "scaledValue", "data_type": "REAL", "description": "Scaled output value" }
    ],
    "in_out": [],
    "tags": ["scaling", "analog", "math", "engineering units"]
  }
]`;
}

export function buildLibraryExtractUserMessage(
  docText: string,
  chunkIndex: number,
  totalChunks: number,
): string {
  const chunkNote =
    totalChunks > 1
      ? ` (chunk ${chunkIndex + 1} of ${totalChunks} — extract only blocks found in THIS chunk)`
      : "";

  return `Extract all callable blocks from this library documentation${chunkNote}:\n\n${docText}`;
}
