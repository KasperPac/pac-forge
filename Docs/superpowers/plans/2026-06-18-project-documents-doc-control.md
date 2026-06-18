# Project Documents Tab → Dropbox Doc-Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project Documents tab's Supabase-storage uploader with a Dropbox-backed browser of the job's `51 DOC` folder, with deterministic document-control (conforming / non-conforming / needs-review / customer-supplied), in-app fix/rename, auto-numbered uploads, and native local-open.

**Architecture:** A pure, deterministic `doc-control.ts` library does all parsing/classification/numbering (no AI). A TanStack Query hook lists/uploads/moves files via the existing `dropbox` edge function (new `move-file` action added). A new `project_doc_overrides` table persists customer-supplied exemptions. Local-open goes through a new `/fs/open-file` endpoint on the PacForge bridge, with a copy-path fallback. A new `ProjectDocuments` component tree replaces `DocumentsEditor` in `project-detail.tsx`.

**Tech Stack:** React 19 + Vite + TypeScript 5.9, TanStack Query, Zustand, shadcn/ui, Vitest, Supabase (Postgres + Edge Functions/Deno), .NET Framework 4.8 (C# 7.3) bridge.

**Spec:** `Docs/superpowers/specs/2026-06-18-project-documents-doc-control-design.md`

## Global Constraints

- TypeScript: `verbatimModuleSyntax` (use `import type`), no enums (use `as const`), `noUnusedLocals`/`noUnusedParameters` — unused vars fail the build.
- Imports use the `@/` alias for `src/`.
- Styling: Tailwind utility classes only (light-first Pac tokens: `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-pac-blue-50`, `text-pac-blue-700`, signal colors `text-pac-signal-green/amber/red` + `-bg`). No inline styles, no new UI libs.
- The numbering convention is **generic**: folder code = leading digits of the documents-folder name; sub-folder code = leading digits of the immediate sub-folder name. Never hardcode `51`, project numbers, or sub-folder names as constants in logic.
- Doc-control governs the **number only**; revision/version (` 1.0`) is preserved and defaulted, never enforced (v1 non-goal).
- Bridge HTTP base URL: `DEFAULT_BRIDGE_CONFIG.baseUrl` (`http://localhost:5102`) from `@/lib/tia-bridge-contract`.
- Run frontend tests with `npm run test -- --run <path>`. Build check: `npm run build`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/doc-control.ts` | Pure parse/classify/number logic |
| Create | `src/lib/__tests__/doc-control.test.ts` | Unit tests w/ real-filename fixtures |
| Create | `supabase/migrations/<ts>_project_doc_overrides.sql` | Exemption table + RLS |
| Create | `src/types/doc-control.ts` | `DocState`, `DocOverride`, row types |
| Create | `src/hooks/use-doc-overrides.ts` | CRUD over `project_doc_overrides` |
| Modify | `supabase/functions/dropbox/index.ts` | Add `move-file` action |
| Modify | `bridge/PacForgeBridge/BridgeServer.cs` | Add `POST /fs/open-file` route + handler |
| Create | `src/hooks/use-project-docs.ts` | List/upload/move Dropbox docs + path derivation |
| Create | `src/hooks/use-open-local-file.ts` | Bridge open-file + fallback |
| Create | `src/components/project-documents/doc-status-badge.tsx` | State → badge |
| Create | `src/components/project-documents/project-documents.tsx` | Tab root: tree nav, summary, rows |
| Create | `src/components/project-documents/upload-doc-dialog.tsx` | Pac-controlled vs customer upload |
| Create | `src/components/project-documents/resolve-doc-dialog.tsx` | needs_review resolution |
| Modify | `src/routes/project-detail.tsx` | Swap `DocumentsEditor` → `ProjectDocuments` |

---

## Task 1: Deterministic doc-control library

**Files:**
- Create: `src/lib/doc-control.ts`
- Test: `src/lib/__tests__/doc-control.test.ts`

**Interfaces:**
- Produces:
  - `type DocState = "conforming" | "non_conforming" | "needs_review" | "customer_supplied"`
  - `interface ParsedDocNumber { projectNumber: string; folderCode: string; subfolderCode: string; seq: string; version: string | null; isPlaceholder: boolean }`
  - `parseDocNumber(filename: string): ParsedDocNumber | null`
  - `folderCodeFromName(name: string): string | null`
  - `isVendorFolderName(name: string): boolean`
  - `interface ClassifyInput { filename: string; docFolderCode: string; subfolderCode: string | null; projectNumber: string; isVendorFolder: boolean; hasOverride: boolean }`
  - `interface ClassifyResult { state: DocState; reasons: string[]; suggestedName?: string }`
  - `classifyDoc(input: ClassifyInput): ClassifyResult`
  - `nextSequence(filenames: string[], docFolderCode: string, subfolderCode: string): string`
  - `buildDocNumber(p: { projectNumber: string; folderCode: string; subfolderCode: string; seq: string; version?: string | null }): string`
  - `suggestAssignName(originalName: string, p: { projectNumber: string; folderCode: string; subfolderCode: string; seq: string; version?: string | null }): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/doc-control.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseDocNumber,
  folderCodeFromName,
  isVendorFolderName,
  classifyDoc,
  nextSequence,
  buildDocNumber,
  suggestAssignName,
} from "@/lib/doc-control";

describe("folderCodeFromName", () => {
  it("reads leading digits", () => {
    expect(folderCodeFromName("51 DOC")).toBe("51");
    expect(folderCodeFromName("01 REFERENCE DOCS")).toBe("01");
    expect(folderCodeFromName("REFERENCE DOCS")).toBeNull();
  });
});

describe("isVendorFolderName", () => {
  it("matches vendor folders by name", () => {
    expect(isVendorFolderName("06 VENDOR MANUALS")).toBe(true);
    expect(isVendorFolderName("07 VENDOR REFERENCE DOCS")).toBe(true);
    expect(isVendorFolderName("01 REFERENCE DOCS")).toBe(false);
  });
});

describe("parseDocNumber", () => {
  it("parses a conforming Pac number", () => {
    const p = parseDocNumber("SRE-2601-5101001 1.0.xlsx");
    expect(p).toEqual({
      projectNumber: "SRE-2601",
      folderCode: "51",
      subfolderCode: "01",
      seq: "001",
      version: "1.0",
      isPlaceholder: false,
    });
  });

  it("parses a placeholder/wrong-folder number", () => {
    const p = parseDocNumber("XXX-17XX-5003001 - 1.0 PLC CHANGELOG.xlsx");
    expect(p?.projectNumber).toBe("XXX-17XX");
    expect(p?.folderCode).toBe("50");
    expect(p?.subfolderCode).toBe("03");
    expect(p?.isPlaceholder).toBe(true);
  });

  it("returns null for an un-numbered customer file", () => {
    expect(parseDocNumber("Herrenknecht - Segment Wagon.pdf")).toBeNull();
    expect(parseDocNumber("SRL-Segment-Wagon-IO-List-v2.csv")).toBeNull();
  });
});

describe("classifyDoc", () => {
  const base = {
    docFolderCode: "51",
    projectNumber: "SRE-2601",
    isVendorFolder: false,
    hasOverride: false,
  };

  it("conforming when all parts match", () => {
    const r = classifyDoc({ ...base, filename: "SRE-2601-5101001 1.0.xlsx", subfolderCode: "01" });
    expect(r.state).toBe("conforming");
    expect(r.reasons).toEqual([]);
  });

  it("non_conforming on placeholder + wrong folder code", () => {
    const r = classifyDoc({
      ...base,
      filename: "XXX-17XX-5003001 - 1.0 PLC CHANGELOG.xlsx",
      subfolderCode: "03",
    });
    expect(r.state).toBe("non_conforming");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.suggestedName).toContain("SRE-2601-5103");
  });

  it("non_conforming on malformed placeholder that does not parse", () => {
    const r = classifyDoc({ ...base, filename: "XXX-18XX-5110-XXX1801.docx", subfolderCode: "10" });
    expect(r.state).toBe("non_conforming");
  });

  it("needs_review for unnumbered file with no override", () => {
    const r = classifyDoc({ ...base, filename: "Herrenknecht - Segment Wagon.pdf", subfolderCode: "01" });
    expect(r.state).toBe("needs_review");
  });

  it("customer_supplied when unnumbered + override", () => {
    const r = classifyDoc({
      ...base,
      filename: "Herrenknecht - Segment Wagon.pdf",
      subfolderCode: "01",
      hasOverride: true,
    });
    expect(r.state).toBe("customer_supplied");
  });

  it("customer_supplied when unnumbered + vendor folder", () => {
    const r = classifyDoc({
      ...base,
      filename: "Some Vendor Manual.pdf",
      subfolderCode: "06",
      isVendorFolder: true,
    });
    expect(r.state).toBe("customer_supplied");
  });

  it("non_conforming when sub-folder code mismatches location", () => {
    const r = classifyDoc({ ...base, filename: "SRE-2601-5101001 1.0.xlsx", subfolderCode: "04" });
    expect(r.state).toBe("non_conforming");
    expect(r.reasons.join(" ")).toMatch(/sub-folder/i);
  });

  it("is generic across a different project shape", () => {
    const r = classifyDoc({
      filename: "PAC-2614-6002005 2.1.docx",
      docFolderCode: "60",
      subfolderCode: "02",
      projectNumber: "PAC-2614",
      isVendorFolder: false,
      hasOverride: false,
    });
    expect(r.state).toBe("conforming");
  });
});

describe("nextSequence", () => {
  it("returns max+1 zero-padded for the folder+subfolder", () => {
    const files = [
      "SRE-2601-5101001 1.0.xlsx",
      "SRE-2601-5101004 1.0.pdf",
      "SRE-2601-5104002 1.0.docx", // different subfolder, ignored
      "Herrenknecht.pdf", // unnumbered, ignored
    ];
    expect(nextSequence(files, "51", "01")).toBe("005");
  });

  it("starts at 001 when none exist", () => {
    expect(nextSequence([], "51", "01")).toBe("001");
  });
});

describe("buildDocNumber + suggestAssignName", () => {
  it("builds the canonical number with default version", () => {
    expect(
      buildDocNumber({ projectNumber: "SRE-2601", folderCode: "51", subfolderCode: "01", seq: "002" }),
    ).toBe("SRE-2601-5101002 1.0");
  });

  it("prefixes an adopted customer file, preserving its name + extension", () => {
    const name = suggestAssignName("Herrenknecht - Segment Wagon.pdf", {
      projectNumber: "SRE-2601",
      folderCode: "51",
      subfolderCode: "01",
      seq: "005",
    });
    expect(name).toBe("SRE-2601-5101005 1.0 - Herrenknecht - Segment Wagon.pdf");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --run src/lib/__tests__/doc-control.test.ts`
Expected: FAIL — cannot resolve `@/lib/doc-control`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/doc-control.ts`:

```ts
/**
 * doc-control.ts — deterministic Pac document numbering + control.
 *
 * Convention (generic): a controlled Pac document is named
 *   {ProjectNumber}-{FF}{SS}{NNN} {version}[ - description].ext
 * where FF = leading digits of the documents folder ("51 DOC" → "51"),
 * SS = leading digits of the sub-folder ("01 REFERENCE DOCS" → "01"),
 * NNN = 3-digit sequence, version e.g. "1.0".
 *
 * Nothing project-specific is hardcoded — codes come from folder names.
 */

export type DocState =
  | "conforming"
  | "non_conforming"
  | "needs_review"
  | "customer_supplied";

export interface ParsedDocNumber {
  projectNumber: string;
  folderCode: string;
  subfolderCode: string;
  seq: string;
  version: string | null;
  isPlaceholder: boolean;
}

// {prefix}-{mid}-{FF}{SS}{NNN}  e.g. SRE-2601-5101001 ; XXX-17XX-5003001
const DOC_NUMBER_RE =
  /\b([A-Za-z]{2,5})-([A-Za-z0-9]{2,4})-(\d{2})(\d{2})(\d{2,4})\b/;

const PLACEHOLDER_RE = /X{3,}/i;

/** Leading digits of a folder name, or null. */
export function folderCodeFromName(name: string): string | null {
  const m = name.match(/^\s*(\d+)/);
  return m ? m[1] : null;
}

/** A folder is vendor/customer-supplied by its name. */
export function isVendorFolderName(name: string): boolean {
  return /vendor/i.test(name);
}

/** Parse a Pac document-number token from a filename. */
export function parseDocNumber(filename: string): ParsedDocNumber | null {
  const m = filename.match(DOC_NUMBER_RE);
  if (!m) return null;
  const [, prefix, mid, folderCode, subfolderCode, rawSeq] = m;
  const projectNumber = `${prefix}-${mid}`;
  const isPlaceholder = PLACEHOLDER_RE.test(projectNumber);

  // Version: " 1.0" appearing after the token.
  const after = filename.slice((m.index ?? 0) + m[0].length);
  const vMatch = after.match(/^[\s-]*(\d+\.\d+)/);

  return {
    projectNumber,
    folderCode,
    subfolderCode,
    seq: rawSeq,
    version: vMatch ? vMatch[1] : null,
    isPlaceholder,
  };
}

export function buildDocNumber(p: {
  projectNumber: string;
  folderCode: string;
  subfolderCode: string;
  seq: string;
  version?: string | null;
}): string {
  const seq = p.seq.padStart(3, "0");
  const version = p.version ?? "1.0";
  return `${p.projectNumber}-${p.folderCode}${p.subfolderCode}${seq} ${version}`;
}

function splitExt(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

/** Build a name for an un-numbered file being adopted as Pac-controlled. */
export function suggestAssignName(
  originalName: string,
  p: {
    projectNumber: string;
    folderCode: string;
    subfolderCode: string;
    seq: string;
    version?: string | null;
  },
): string {
  const { base, ext } = splitExt(originalName);
  return `${buildDocNumber(p)} - ${base}${ext}`;
}

/** Fix a file that already carries a (wrong) number token. */
function suggestFixName(
  originalName: string,
  parsed: ParsedDocNumber,
  correct: { projectNumber: string; folderCode: string; subfolderCode: string },
): string {
  const seq = parsed.seq.padStart(3, "0");
  const correctToken = `${correct.projectNumber}-${correct.folderCode}${correct.subfolderCode}${seq}`;
  return originalName.replace(DOC_NUMBER_RE, correctToken);
}

export interface ClassifyInput {
  filename: string;
  docFolderCode: string;
  subfolderCode: string | null;
  projectNumber: string;
  isVendorFolder: boolean;
  hasOverride: boolean;
}

export interface ClassifyResult {
  state: DocState;
  reasons: string[];
  suggestedName?: string;
}

export function classifyDoc(input: ClassifyInput): ClassifyResult {
  const { filename, docFolderCode, subfolderCode, projectNumber } = input;
  const parsed = parseDocNumber(filename);

  // No parseable number token.
  if (!parsed) {
    // A placeholder stub that didn't parse cleanly is still a Pac doc gone wrong.
    if (PLACEHOLDER_RE.test(filename)) {
      return {
        state: "non_conforming",
        reasons: ["malformed or placeholder document number"],
      };
    }
    if (input.isVendorFolder || input.hasOverride) {
      return { state: "customer_supplied", reasons: [] };
    }
    return { state: "needs_review", reasons: [] };
  }

  const reasons: string[] = [];
  if (parsed.isPlaceholder) {
    reasons.push(`placeholder project number "${parsed.projectNumber}"`);
  } else if (parsed.projectNumber !== projectNumber) {
    reasons.push(`project number "${parsed.projectNumber}" ≠ "${projectNumber}"`);
  }
  if (parsed.folderCode !== docFolderCode) {
    reasons.push(`folder code "${parsed.folderCode}" ≠ "${docFolderCode}"`);
  }
  if (subfolderCode !== null && parsed.subfolderCode !== subfolderCode) {
    reasons.push(`sub-folder code "${parsed.subfolderCode}" ≠ "${subfolderCode}"`);
  }
  if (parsed.seq.length !== 3) {
    reasons.push("sequence must be 3 digits");
  }

  if (reasons.length === 0) {
    return { state: "conforming", reasons: [] };
  }

  const suggestedName = suggestFixName(filename, parsed, {
    projectNumber,
    folderCode: docFolderCode,
    subfolderCode: subfolderCode ?? parsed.subfolderCode,
  });
  return { state: "non_conforming", reasons, suggestedName };
}

/** Next 3-digit sequence for a given folder + sub-folder, from existing names. */
export function nextSequence(
  filenames: string[],
  docFolderCode: string,
  subfolderCode: string,
): string {
  let max = 0;
  for (const name of filenames) {
    const p = parseDocNumber(name);
    if (!p) continue;
    if (p.folderCode !== docFolderCode || p.subfolderCode !== subfolderCode) continue;
    const n = parseInt(p.seq, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --run src/lib/__tests__/doc-control.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/doc-control.ts src/lib/__tests__/doc-control.test.ts
git commit -m "feat(doc-control): deterministic Pac document numbering + classification"
```

---

## Task 2: `project_doc_overrides` table + types + hook

**Files:**
- Create: `supabase/migrations/<timestamp>_project_doc_overrides.sql`
- Create: `src/types/doc-control.ts`
- Create: `src/hooks/use-doc-overrides.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `DocState` from `@/lib/doc-control`.
- Produces:
  - `interface DocOverride { id: string; project_id: string; rel_path: string; classification: "customer_supplied"; note: string | null; resolved_by: string | null; resolved_at: string }`
  - `useDocOverrides(projectId: string | undefined)` → query returning `DocOverride[]`
  - `useAddDocOverride()` → mutation `({ projectId, relPath, note? }) => void`
  - `useRemoveDocOverride()` → mutation `({ id, projectId }) => void`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/<timestamp>_project_doc_overrides.sql` (use a timestamp newer than `20260617032807`, e.g. `20260618120000_project_doc_overrides.sql`):

```sql
-- ============================================================
-- project_doc_overrides — customer-supplied document exemptions
-- for the project Documents tab doc-control. Only stores files a
-- user has explicitly marked exempt from the Pac numbering convention.
-- ============================================================

CREATE TABLE project_doc_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path text NOT NULL,
  classification text NOT NULL DEFAULT 'customer_supplied'
    CHECK (classification IN ('customer_supplied')),
  note text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, rel_path)
);

CREATE INDEX project_doc_overrides_project_idx
  ON project_doc_overrides(project_id);

ALTER TABLE project_doc_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_doc_overrides_select ON project_doc_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY project_doc_overrides_insert ON project_doc_overrides
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY project_doc_overrides_update ON project_doc_overrides
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY project_doc_overrides_delete ON project_doc_overrides
  FOR DELETE TO authenticated USING (true);
```

- [ ] **Step 2: Create the types**

Create `src/types/doc-control.ts`:

```ts
export interface DocOverride {
  id: string;
  project_id: string;
  rel_path: string;
  classification: "customer_supplied";
  note: string | null;
  resolved_by: string | null;
  resolved_at: string;
}
```

- [ ] **Step 3: Create the hook**

Create `src/hooks/use-doc-overrides.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DocOverride } from "@/types/doc-control";

const KEY = (projectId: string) => ["doc-overrides", projectId] as const;

export function useDocOverrides(projectId: string | undefined) {
  return useQuery({
    queryKey: KEY(projectId ?? ""),
    queryFn: async (): Promise<DocOverride[]> => {
      const { data, error } = await supabase
        .from("project_doc_overrides")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocOverride[];
    },
    enabled: !!projectId,
  });
}

export function useAddDocOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { projectId: string; relPath: string; note?: string }) => {
      const { error } = await supabase.from("project_doc_overrides").insert({
        project_id: p.projectId,
        rel_path: p.relPath,
        classification: "customer_supplied",
        note: p.note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: KEY(p.projectId) }),
  });
}

export function useRemoveDocOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; projectId: string }) => {
      const { error } = await supabase
        .from("project_doc_overrides")
        .delete()
        .eq("id", p.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: KEY(p.projectId) }),
  });
}
```

- [ ] **Step 4: Apply the migration and verify build**

Run: `npx supabase db push`
Expected: migration applies cleanly (table created).

Run: `npm run build`
Expected: typecheck passes (no unused/type errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations src/types/doc-control.ts src/hooks/use-doc-overrides.ts
git commit -m "feat(doc-control): project_doc_overrides table + overrides hook"
```

---

## Task 3: Edge function `move-file` action

**Files:**
- Modify: `supabase/functions/dropbox/index.ts` (add handler + router case near `handleUploadFile` / the `switch`)

**Interfaces:**
- Produces: `dropbox` edge action `move-file` with body `{ action: "move-file", from_path: string, to_path: string }` → `{ moved: true, path: string }` or `{ error }`.

- [ ] **Step 1: Add the handler**

In `supabase/functions/dropbox/index.ts`, add after `handleUploadFile` (around line 493):

```ts
async function handleMoveFile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const fromPath = body.from_path as string;
  const toPath = body.to_path as string;
  if (!fromPath || !toPath) {
    return jsonResponse({ error: "from_path and to_path required" }, 400);
  }

  const { token, rootNamespaceId, error: tokenErr } = await getValidToken(supabase, userId);
  if (tokenErr) return jsonResponse({ error: tokenErr }, 401);

  const result = await dropboxApi(
    token,
    "/files/move_v2",
    { from_path: fromPath, to_path: toPath, autorename: false },
    rootNamespaceId
  );

  if (!result.ok) {
    return jsonResponse({ error: result.error ?? "Failed to move file" }, 500);
  }

  const meta = result.data?.metadata as Record<string, unknown> | undefined;
  return jsonResponse(
    { moved: true, path: meta?.path_display ?? toPath },
    200
  );
}
```

- [ ] **Step 2: Register the router case**

In the `switch (action)` block (around line 651), add after the `upload-file` case:

```ts
      case "move-file":
        return await handleMoveFile(supabase, user.id, body);
```

- [ ] **Step 3: Deploy and smoke-test**

Run: `npx supabase functions deploy dropbox`
Expected: deploy succeeds.

Manual smoke (optional, via the app once Task 5 lands): rename a test file and confirm it moves in Dropbox.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/dropbox/index.ts
git commit -m "feat(dropbox): move-file action for doc-control rename/fix"
```

---

## Task 4: Bridge `POST /fs/open-file` endpoint

**Files:**
- Modify: `bridge/PacForgeBridge/BridgeServer.cs` (add route in `HandleRequest`; add handler method)

**Interfaces:**
- Produces: `POST http://localhost:5102/fs/open-file` body `{ "path": "C:\\...\\file.xlsx" }` → `{ "success": true }` or `{ "success": false, "message": "..." }`. Only opens paths under the configured Dropbox root (guard).

> The bridge already exposes `ReadBody(req)` → `string`, `Json.Deserialize<T>(body)`, and `WriteJson(res, status, obj)`. Follow the existing route pattern (`if (method == "POST" && path == "/...")`).

- [ ] **Step 1: Add the route**

In `BridgeServer.cs` `HandleRequest`, alongside the other routes (e.g. after the `/tia/browse-file` block around line 105), add:

```csharp
                // Route: POST /fs/open-file
                if (method == "POST" && path == "/fs/open-file")
                {
                    await HandleOpenFile(req, res);
                    return;
                }
```

- [ ] **Step 2: Add the handler method**

Add this method to the class (e.g. after `HandleBrowseFile`, around line 530):

```csharp
        private async Task HandleOpenFile(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body = await ReadBody(req);
            var request = Json.Deserialize<OpenFileRequest>(body);
            string filePath = request?.Path;

            if (string.IsNullOrEmpty(filePath))
            {
                await WriteJson(res, 400, new { success = false, message = "path is required" });
                return;
            }

            // Guard: only open files that actually exist on disk.
            if (!System.IO.File.Exists(filePath))
            {
                await WriteJson(res, 404, new { success = false, message = "File not found: " + filePath });
                return;
            }

            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo(filePath)
                {
                    UseShellExecute = true,
                };
                System.Diagnostics.Process.Start(psi);
                await WriteJson(res, 200, new { success = true });
            }
            catch (Exception ex)
            {
                await WriteJson(res, 500, new { success = false, message = ex.Message });
            }
        }
```

- [ ] **Step 3: Add the request DTO**

Add a small DTO near the other request types (or in the same file if DTOs live inline — match the location of `BrowseFileRequest`):

```csharp
        public class OpenFileRequest
        {
            public string Path { get; set; }
        }
```

> If `BrowseFileRequest` is defined in a separate models file, add `OpenFileRequest` next to it there instead.

- [ ] **Step 4: Build the bridge**

Run: `dotnet build bridge/PacForgeBridge.sln`
Expected: build succeeds (the Dropbox-root guard is enforced on the client side by only ever sending paths under the root; the bridge guards on existence).

- [ ] **Step 5: Commit**

```bash
git add bridge/PacForgeBridge/BridgeServer.cs
git commit -m "feat(bridge): POST /fs/open-file to shell-open a local document"
```

---

## Task 5: `use-project-docs` hook (list / upload / move)

**Files:**
- Create: `src/hooks/use-project-docs.ts`

**Interfaces:**
- Consumes: `supabase.functions.invoke("dropbox", ...)`; `toDropboxApiPath` from `@/lib/dropbox-paths`; `useUiStore` `dropboxRoot`.
- Produces:
  - `interface DropboxEntry { name: string; path: string; tag: "file" | "folder" }`
  - `docFolderApiPath(dropboxFolderPath, dropboxRoot): string | null` — returns `<apiBase>/51 DOC`
  - `useDocFolderListing(projectFolderApiPath, subPath)` → query of `DropboxEntry[]` for `<docRoot>/<subPath>`
  - `useUploadDocFile()` → mutation `({ apiFolderPath, filename, file }) => void`
  - `useMoveDocFile()` → mutation `({ fromPath, toPath }) => void`

- [ ] **Step 1: Write the hook**

Create `src/hooks/use-project-docs.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDropboxApiPath } from "@/lib/dropbox-paths";

export interface DropboxEntry {
  name: string;
  path: string;
  tag: "file" | "folder";
}

/** Name of the documents folder within a job folder. */
export const DOC_FOLDER_NAME = "51 DOC";

async function invokeDropbox(action: string, params?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("dropbox", {
    body: { action, ...params },
  });
  if (error) {
    let detail = error.message;
    if (error.context && typeof error.context.json === "function") {
      const b = await error.context.json().catch(() => null);
      if (b?.error) detail = b.error;
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Dropbox-API path of the documents folder, or null if not resolvable. */
export function docFolderApiPath(
  dropboxFolderPath: string | null | undefined,
  dropboxRoot: string,
): string | null {
  if (!dropboxFolderPath || !dropboxRoot) return null;
  const base = toDropboxApiPath(dropboxFolderPath, dropboxRoot);
  if (!base) return null;
  return `${base}/${DOC_FOLDER_NAME}`;
}

/** List entries at <docRootApiPath>/<subPath> (subPath may be ""). */
export function useDocFolderListing(
  docRootApiPath: string | null,
  subPath: string,
) {
  const fullPath = docRootApiPath
    ? subPath
      ? `${docRootApiPath}/${subPath}`
      : docRootApiPath
    : null;
  return useQuery({
    queryKey: ["doc-folder", fullPath],
    queryFn: async (): Promise<DropboxEntry[]> => {
      const result = await invokeDropbox("list-folder", { path: fullPath });
      return (result.entries as DropboxEntry[]) ?? [];
    },
    enabled: !!fullPath,
    staleTime: 15_000,
  });
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function useUploadDocFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { apiFolderPath: string; filename: string; file: File }) => {
      const content_base64 = await fileToBase64(p.file);
      await invokeDropbox("upload-file", {
        path: `${p.apiFolderPath}/${p.filename}`,
        content_base64,
        mode: "add",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-folder"] }),
  });
}

export function useMoveDocFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { fromPath: string; toPath: string }) => {
      await invokeDropbox("move-file", { from_path: p.fromPath, to_path: p.toPath });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-folder"] }),
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-project-docs.ts
git commit -m "feat(doc-control): use-project-docs hook (list/upload/move Dropbox docs)"
```

---

## Task 6: `use-open-local-file` hook

**Files:**
- Create: `src/hooks/use-open-local-file.ts`

**Interfaces:**
- Consumes: `DEFAULT_BRIDGE_CONFIG` from `@/lib/tia-bridge-contract`.
- Produces: `useOpenLocalFile()` → mutation `(localPath: string) => void` that POSTs to the bridge; throws on failure so the caller can fall back.

- [ ] **Step 1: Write the hook**

Create `src/hooks/use-open-local-file.ts`:

```ts
import { useMutation } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

export function useOpenLocalFile() {
  return useMutation({
    mutationFn: async (localPath: string) => {
      const resp = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/fs/open-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (!resp) {
        throw new Error("bridge-unreachable");
      }
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message ?? "open-failed");
      }
    },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-open-local-file.ts
git commit -m "feat(doc-control): use-open-local-file hook (bridge shell-open)"
```

---

## Task 7: Status badge + read-only document browser

**Files:**
- Create: `src/components/project-documents/doc-status-badge.tsx`
- Create: `src/components/project-documents/project-documents.tsx`

**Interfaces:**
- Consumes: `DocState`, `classifyDoc`, `folderCodeFromName`, `isVendorFolderName` from `@/lib/doc-control`; `useDocFolderListing`, `docFolderApiPath`, `DropboxEntry`, `DOC_FOLDER_NAME` from `@/hooks/use-project-docs`; `useDocOverrides` from `@/hooks/use-doc-overrides`; `useUiStore`; `Project` from `@/types/project`.
- Produces:
  - `<DocStatusBadge state={DocState} />`
  - `<ProjectDocuments project={Project} />` (default export) — tree nav + summary + rows. Mutations/dialogs land in Task 8; this task renders rows with classification and a disabled action placeholder.

- [ ] **Step 1: Status badge component**

Create `src/components/project-documents/doc-status-badge.tsx`:

```tsx
import type { DocState } from "@/lib/doc-control";

const STYLES: Record<DocState, { label: string; cls: string }> = {
  conforming: {
    label: "Conforming",
    cls: "bg-pac-signal-green-bg text-pac-signal-green border-pac-signal-green/30",
  },
  non_conforming: {
    label: "Non-conforming",
    cls: "bg-pac-signal-red-bg text-pac-signal-red border-pac-signal-red/30",
  },
  needs_review: {
    label: "Needs review",
    cls: "bg-pac-signal-amber-bg text-pac-signal-amber border-pac-signal-amber/30",
  },
  customer_supplied: {
    label: "Customer-supplied",
    cls: "bg-muted text-muted-foreground border-border",
  },
};

export function DocStatusBadge({ state }: { state: DocState }) {
  const s = STYLES[state];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
```

> If `bg-pac-signal-amber-bg` / `text-pac-signal-amber` tokens don't exist, use the closest existing amber tokens — check `src/styles/pac-tokens.css` first and match what's there.

- [ ] **Step 2: Document browser component**

Create `src/components/project-documents/project-documents.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Folder, FileText, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useUiStore } from "@/stores/ui-store";
import type { Project } from "@/types/project";
import {
  classifyDoc,
  folderCodeFromName,
  isVendorFolderName,
  type DocState,
} from "@/lib/doc-control";
import {
  docFolderApiPath,
  useDocFolderListing,
  DOC_FOLDER_NAME,
  type DropboxEntry,
} from "@/hooks/use-project-docs";
import { useDocOverrides } from "@/hooks/use-doc-overrides";
import { DocStatusBadge } from "./doc-status-badge";

export default function ProjectDocuments({ project }: { project: Project }) {
  const dropboxRoot = useUiStore((s) => s.dropboxRoot);
  const docRoot = docFolderApiPath(project.dropbox_folder_path, dropboxRoot);

  // subPath: "" at the 51 DOC root, else "01 REFERENCE DOCS" etc.
  const [subPath, setSubPath] = useState("");
  const { data: entries = [], isLoading, error } = useDocFolderListing(docRoot, subPath);
  const { data: overrides = [] } = useDocOverrides(project.id);

  const docFolderCode = folderCodeFromName(DOC_FOLDER_NAME) ?? "51";
  // Current sub-folder is the last segment of subPath (if any).
  const currentSubName = subPath.split("/").pop() ?? "";
  const subfolderCode = subPath ? folderCodeFromName(currentSubName) : null;
  const isVendorFolder = subPath ? isVendorFolderName(currentSubName) : false;

  const overrideSet = useMemo(
    () => new Set(overrides.map((o) => o.rel_path)),
    [overrides],
  );

  const folders = entries.filter((e) => e.tag === "folder");
  const files = entries.filter((e) => e.tag === "file");

  function relPath(entry: DropboxEntry): string {
    return subPath
      ? `${DOC_FOLDER_NAME}/${subPath}/${entry.name}`
      : `${DOC_FOLDER_NAME}/${entry.name}`;
  }

  const classified = files.map((f) => ({
    entry: f,
    result: classifyDoc({
      filename: f.name,
      docFolderCode,
      subfolderCode,
      projectNumber: project.project_number ?? "",
      isVendorFolder,
      hasOverride: overrideSet.has(relPath(f)),
    }),
  }));

  const counts = classified.reduce(
    (acc, c) => {
      acc[c.result.state] += 1;
      return acc;
    },
    { conforming: 0, non_conforming: 0, needs_review: 0, customer_supplied: 0 } as Record<DocState, number>,
  );

  if (!project.dropbox_folder_path) {
    return (
      <Card className="p-4">
        <p className="font-mono text-sm text-muted-foreground">
          No Dropbox job folder is set for this project. Set the folder on the
          project Overview to browse documents.
        </p>
      </Card>
    );
  }

  if (!dropboxRoot) {
    return (
      <Card className="p-4">
        <p className="font-mono text-sm text-muted-foreground">
          Local Dropbox root is not configured. Set it in your profile to resolve
          document paths.
        </p>
      </Card>
    );
  }

  const breadcrumb = subPath ? subPath.split("/") : [];

  return (
    <Card className="p-4 space-y-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <button className="hover:text-foreground" onClick={() => setSubPath("")}>
          {DOC_FOLDER_NAME}
        </button>
        {breadcrumb.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button
              className="hover:text-foreground"
              onClick={() => setSubPath(breadcrumb.slice(0, i + 1).join("/"))}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Conformance summary */}
      <div className="flex flex-wrap gap-3 font-mono text-xs">
        <span className="text-pac-signal-green">{counts.conforming} conforming</span>
        <span className="text-pac-signal-red">{counts.non_conforming} non-conforming</span>
        <span className="text-pac-signal-amber">{counts.needs_review} need review</span>
        <span className="text-muted-foreground">{counts.customer_supplied} customer-supplied</span>
      </div>

      {error && (
        <p className="font-mono text-sm text-pac-signal-red">{String(error)}</p>
      )}
      {isLoading && (
        <p className="font-mono text-sm text-muted-foreground">Loading…</p>
      )}

      {/* Folders */}
      {folders.map((f) => (
        <button
          key={f.path}
          className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-muted"
          onClick={() => setSubPath(subPath ? `${subPath}/${f.name}` : f.name)}
        >
          <Folder className="h-4 w-4 text-pac-blue-600" />
          <span className="font-mono text-xs text-foreground">{f.name}</span>
        </button>
      ))}

      {/* Files */}
      {classified.map(({ entry, result }) => (
        <div
          key={entry.path}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-foreground">{entry.name}</span>
            <DocStatusBadge state={result.state} />
          </div>
          {/* Actions wired in Task 8 */}
        </div>
      ))}

      {!isLoading && folders.length === 0 && files.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">This folder is empty.</p>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: passes. (If amber/green/red signal token classes don't exist, fix per the note in Step 1.)

- [ ] **Step 4: Commit**

```bash
git add src/components/project-documents/doc-status-badge.tsx src/components/project-documents/project-documents.tsx
git commit -m "feat(doc-control): document browser with classification + summary"
```

---

## Task 8: Actions — open, fix, resolve, upload

**Files:**
- Create: `src/components/project-documents/resolve-doc-dialog.tsx`
- Create: `src/components/project-documents/upload-doc-dialog.tsx`
- Modify: `src/components/project-documents/project-documents.tsx` (wire actions)

**Interfaces:**
- Consumes: `useOpenLocalFile`, `useMoveDocFile`, `useUploadDocFile`, `useAddDocOverride`, `nextSequence`, `suggestAssignName`, `buildDocNumber`.
- Produces: `<ResolveDocDialog>` and `<UploadDocDialog>` plus per-row Open / Fix / Resolve buttons.

> Reuse the existing shadcn `Dialog` primitives (`@/components/ui/dialog`) and `Button` (`@/components/ui/button`) — match how other dialogs in the repo import them.

- [ ] **Step 1: Resolve dialog**

Create `src/components/project-documents/resolve-doc-dialog.tsx`:

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ResolveContext {
  filename: string;
  fromPath: string;        // Dropbox API path of the file
  apiFolderPath: string;   // Dropbox API path of the containing folder
  suggestedName: string;   // assign-number suggestion
  relPath: string;         // project-relative path for the override row
}

export function ResolveDocDialog({
  ctx,
  open,
  onOpenChange,
  onAssignNumber,
  onMarkCustomer,
  busy,
}: {
  ctx: ResolveContext | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAssignNumber: (ctx: ResolveContext) => void;
  onMarkCustomer: (ctx: ResolveContext, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  if (!ctx) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Resolve document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 font-mono text-xs">
          <p className="text-muted-foreground">{ctx.filename}</p>
          <div className="rounded-md border border-border p-2">
            <div className="text-muted-foreground">Assign Pac number →</div>
            <div className="text-foreground">{ctx.suggestedName}</div>
          </div>
          <input
            className="w-full rounded-sm border border-border bg-background px-2 py-1"
            placeholder="Note (optional, for customer-supplied)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onMarkCustomer(ctx, note)}
          >
            Mark customer-supplied
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onAssignNumber(ctx)}>
            Assign Pac number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Upload dialog**

Create `src/components/project-documents/upload-doc-dialog.tsx`:

```tsx
import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface UploadResult {
  file: File;
  filename: string;       // final name (auto-numbered or original)
  markCustomer: boolean;  // record an exemption override after upload
}

export function UploadDocDialog({
  open,
  onOpenChange,
  computeNumberedName,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Given a picked file, return the auto-numbered name for a Pac doc. */
  computeNumberedName: (file: File) => string;
  onConfirm: (r: UploadResult) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const numberedName = file ? computeNumberedName(file) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Upload document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 font-mono text-xs">
          <input
            ref={inputRef}
            type="file"
            className="block w-full text-xs"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <div className="rounded-md border border-border p-2 text-foreground">
              Pac-controlled name: {numberedName}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!file || busy}
            onClick={() =>
              file && onConfirm({ file, filename: file.name, markCustomer: true })
            }
          >
            Upload as customer-supplied
          </Button>
          <Button
            size="sm"
            disabled={!file || busy}
            onClick={() =>
              file && onConfirm({ file, filename: numberedName, markCustomer: false })
            }
          >
            Upload as Pac-controlled
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire actions into the browser**

In `src/components/project-documents/project-documents.tsx`, add imports:

```tsx
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { nextSequence, suggestAssignName } from "@/lib/doc-control";
import { useOpenLocalFile } from "@/hooks/use-open-local-file";
import { useMoveDocFile, useUploadDocFile } from "@/hooks/use-project-docs";
import { useAddDocOverride } from "@/hooks/use-doc-overrides";
import { ResolveDocDialog, type ResolveContext } from "./resolve-doc-dialog";
import { UploadDocDialog, type UploadResult } from "./upload-doc-dialog";
```

> Toast is imported from `@/hooks/use-toast` (verified — matches `project-detail.tsx`). Signal-color badge classes (`text-pac-signal-green`, `bg-pac-signal-amber-bg`, etc.) are verified present in `tailwind.config.js` / `pac-tokens.css`.

Inside the component, after the existing hooks, add the mutations + handlers:

```tsx
  const openLocal = useOpenLocalFile();
  const moveDoc = useMoveDocFile();
  const uploadDoc = useUploadDocFile();
  const addOverride = useAddDocOverride();

  const [resolveCtx, setResolveCtx] = useState<ResolveContext | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const apiFolderPath = subPath ? `${docRoot}/${subPath}` : docRoot;
  const fileNames = files.map((f) => f.name);

  // Local absolute path = dropboxRoot + dropbox_folder_path tail + subPath + name.
  function localPathFor(entry: DropboxEntry): string {
    // entry.path is the Dropbox display path; convert to a local OS path.
    const tail = entry.path.replace(/\//g, "\\");
    return `${dropboxRoot}${tail}`;
  }

  async function handleOpen(entry: DropboxEntry) {
    try {
      await openLocal.mutateAsync(localPathFor(entry));
    } catch {
      await navigator.clipboard.writeText(localPathFor(entry)).catch(() => {});
      toast({
        title: "Couldn't open locally",
        description: "Bridge unavailable — the file path was copied to your clipboard.",
      });
    }
  }

  async function handleFix(entry: DropboxEntry, suggestedName: string) {
    const from = `${apiFolderPath}/${entry.name}`;
    const to = `${apiFolderPath}/${suggestedName}`;
    await moveDoc.mutateAsync({ fromPath: from, toPath: to });
    toast({ title: "Renamed", description: suggestedName });
  }

  function openResolve(entry: DropboxEntry) {
    if (!subfolderCode) {
      toast({
        title: "Move into a numbered sub-folder first",
        description: "Documents directly under 51 DOC can't be auto-numbered.",
      });
      return;
    }
    const seq = nextSequence(fileNames, docFolderCode, subfolderCode);
    setResolveCtx({
      filename: entry.name,
      fromPath: `${apiFolderPath}/${entry.name}`,
      apiFolderPath: apiFolderPath!,
      suggestedName: suggestAssignName(entry.name, {
        projectNumber: project.project_number ?? "",
        folderCode: docFolderCode,
        subfolderCode,
        seq,
      }),
      relPath: relPath(entry),
    });
  }

  async function handleAssignNumber(ctx: ResolveContext) {
    await moveDoc.mutateAsync({
      fromPath: ctx.fromPath,
      toPath: `${ctx.apiFolderPath}/${ctx.suggestedName}`,
    });
    setResolveCtx(null);
    toast({ title: "Number assigned", description: ctx.suggestedName });
  }

  async function handleMarkCustomer(ctx: ResolveContext, note: string) {
    await addOverride.mutateAsync({ projectId: project.id, relPath: ctx.relPath, note });
    setResolveCtx(null);
    toast({ title: "Marked customer-supplied" });
  }

  function computeNumberedName(file: File): string {
    if (!subfolderCode) return file.name;
    const seq = nextSequence(fileNames, docFolderCode, subfolderCode);
    return suggestAssignName(file.name, {
      projectNumber: project.project_number ?? "",
      folderCode: docFolderCode,
      subfolderCode,
      seq,
    });
  }

  async function handleUpload(r: UploadResult) {
    if (!apiFolderPath) return;
    await uploadDoc.mutateAsync({ apiFolderPath, filename: r.filename, file: r.file });
    if (r.markCustomer) {
      await addOverride.mutateAsync({
        projectId: project.id,
        relPath: subPath
          ? `${DOC_FOLDER_NAME}/${subPath}/${r.filename}`
          : `${DOC_FOLDER_NAME}/${r.filename}`,
      });
    }
    setUploadOpen(false);
    toast({ title: "Uploaded", description: r.filename });
  }
```

Add an **Upload** button to the breadcrumb row:

```tsx
      <div className="flex items-center justify-between">
        {/* existing breadcrumb block goes on the left */}
        <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
          <Upload className="mr-1 h-3.5 w-3.5" /> Upload
        </Button>
      </div>
```

Replace the `{/* Actions wired in Task 8 */}` placeholder in each file row with:

```tsx
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => handleOpen(entry)}>
              Open
            </Button>
            {result.state === "non_conforming" && result.suggestedName && (
              <Button
                size="sm"
                variant="ghost"
                className="text-pac-blue-700"
                onClick={() => handleFix(entry, result.suggestedName!)}
              >
                Fix
              </Button>
            )}
            {result.state === "needs_review" && (
              <Button size="sm" variant="ghost" onClick={() => openResolve(entry)}>
                Resolve
              </Button>
            )}
          </div>
```

Render the dialogs before the closing `</Card>`:

```tsx
      <ResolveDocDialog
        ctx={resolveCtx}
        open={!!resolveCtx}
        onOpenChange={(o) => !o && setResolveCtx(null)}
        onAssignNumber={handleAssignNumber}
        onMarkCustomer={handleMarkCustomer}
        busy={moveDoc.isPending || addOverride.isPending}
      />
      <UploadDocDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        computeNumberedName={computeNumberedName}
        onConfirm={handleUpload}
        busy={uploadDoc.isPending}
      />
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: passes. Resolve unused-import / token issues if any.

- [ ] **Step 5: Commit**

```bash
git add src/components/project-documents/
git commit -m "feat(doc-control): open/fix/resolve/upload actions for documents"
```

---

## Task 9: Wire into the project Documents tab

**Files:**
- Modify: `src/routes/project-detail.tsx` (replace `DocumentsEditor` usage; remove the now-dead component + its Supabase-storage imports if unused elsewhere)

**Interfaces:**
- Consumes: `ProjectDocuments` (default export) from `@/components/project-documents/project-documents`.

- [ ] **Step 1: Swap the tab content**

In `src/routes/project-detail.tsx`, add the import:

```tsx
import ProjectDocuments from "@/components/project-documents/project-documents";
```

Replace the Documents `TabsContent` body:

```tsx
        {/* Documents */}
        <TabsContent value="documents">
          <ProjectDocuments project={project} />
        </TabsContent>
```

- [ ] **Step 2: Remove the dead `DocumentsEditor`**

Delete the `DocumentsEditor` function component and any imports that become unused (`supabase` storage calls, `ACCEPTED_DOC_TYPES`, `Upload`/`FileText` if no longer referenced). Run the build to find unused symbols.

> Leave `project.uploaded_docs` in the type and DB untouched — it's legacy data; this task only stops the tab from writing to it. No migration to drop it.

- [ ] **Step 3: Verify build + full test run**

Run: `npm run build`
Expected: passes with no unused-symbol errors.

Run: `npm run test -- --run src/lib/__tests__/doc-control.test.ts`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Start the dev server (`npm run dev`) and the bridge (`dotnet run --project bridge/PacForgeBridge`). On a project with a `dropbox_folder_path` set (e.g. SRE-2601):
- Documents tab lists `51 DOC` sub-folders; clicking navigates in/out via breadcrumb.
- `01 REFERENCE DOCS` shows `SRE-2601-5101001…` as **Conforming**, customer PDFs as **Needs review**, and `03 PLC CHANGELOG`'s `XXX-…-5003…` as **Non-conforming** with a **Fix** suggesting `SRE-2601-5103001`.
- **Open** launches the file in its native app (bridge running); with the bridge stopped, it copies the path and toasts.
- **Resolve** → Mark customer-supplied flips a needs-review file to Customer-supplied; Assign Pac number renames it and it becomes Conforming.
- **Upload** as Pac-controlled lands a correctly-numbered file in the current sub-folder.

- [ ] **Step 5: Commit**

```bash
git add src/routes/project-detail.tsx
git commit -m "feat(doc-control): wire Dropbox document browser into project Documents tab"
```

---

## Self-Review Notes

- **Spec coverage:** source-of-truth swap (T9), navigable tree (T7), always-prompt unnumbered (T7 classify + T8 resolve), native local open + fallback (T4/T6/T8), full rename/fix (T3/T8), auto-number on upload (T8), generic folder-code rule (T1), vendor auto-exempt (T1 `isVendorFolderName`), persistence of customer-supplied only (T2), `needs_review` for files directly under `51 DOC` (T7 `subfolderCode = null` → classify returns needs_review; T8 blocks auto-number there). All covered.
- **Revision enforcement** intentionally absent (v1 non-goal) — version is preserved via `buildDocNumber` default `1.0` and `parseDocNumber` capture only.
- **Type consistency:** `ParsedDocNumber`, `ClassifyInput/Result`, `DropboxEntry`, `ResolveContext`, `UploadResult`, `DocOverride` names are stable across tasks. `docFolderApiPath`, `useDocFolderListing`, `useMoveDocFile`, `useUploadDocFile`, `useOpenLocalFile`, `useAddDocOverride` signatures match their consumers in T7/T8.
- **Post-task hook:** none of the changed files match the `use-forge-*` / `use-pipeline-*` / `*-prompt*` / `forge-*` / `pipeline.ts` patterns, so the pipeline-auditor gate does not apply to this work.
- **Tokens verified:** `--pac-signal-green/amber/red(-bg)` exist in `src/styles/pac-tokens.css` and are mapped in `tailwind.config.js`; `text-pac-signal-*` / `bg-pac-signal-*-bg` classes are valid (already used in `quote-card.tsx`). Toast import path verified as `@/hooks/use-toast`.
