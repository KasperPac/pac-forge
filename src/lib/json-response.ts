export function getJsonResponseCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();

  function push(candidate: string | undefined): void {
    const value = candidate?.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    push(fenceMatch[1]);
  }

  push(
    trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim(),
  );

  const firstObjectStart = trimmed.indexOf("{");
  const lastObjectEnd = trimmed.lastIndexOf("}");
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    push(trimmed.slice(firstObjectStart, lastObjectEnd + 1));
  }

  const firstArrayStart = trimmed.indexOf("[");
  const lastArrayEnd = trimmed.lastIndexOf("]");
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    push(trimmed.slice(firstArrayStart, lastArrayEnd + 1));
  }

  return candidates;
}

export function parseJsonResponse<T>(raw: string): T | null {
  for (const candidate of getJsonResponseCandidates(raw)) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next extraction strategy.
    }
  }

  return null;
}
