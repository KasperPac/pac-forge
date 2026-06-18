# Project Documents Tab → Dropbox Doc-Control — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorm) — pending implementation plan
**Module:** Projects (project-detail Documents tab)

## Problem

The project master page has a **Documents** tab that today uploads files to a Supabase
Storage bucket (`project-docs`) and stores paths in `project.uploaded_docs`. This is a
parallel, throwaway store disconnected from where documents actually live: the **Dropbox
job folder**.

Engineers want the tab to be a window onto the real `51 DOC` folder of the job — browse it,
open documents, upload into it — and to enforce **document control**: that Pac-authored
documents follow the company numbering convention. Customer/vendor-supplied documents fall
outside the convention and must not be false-flagged.

## Goals

1. The Documents tab browses the project's Dropbox `51 DOC` folder (navigable folder tree).
2. View/open a document (native local open, with graceful fallback).
3. Upload documents into the correct sub-folder, auto-numbered when Pac-controlled.
4. Deterministic **doc-control**: classify every file as conforming / non-conforming /
   needs-review / customer-supplied, and let the user fix or resolve.

## Non-Goals (v1)

- **Revision/version enforcement.** The ` 1.0` suffix is preserved and defaulted, but
  doc-control governs the *number*, not the revision. (Candidate for v2.)
- No bulk "fix all", no in-app content editing, no moving files *between* sub-folders
  (rename-in-place only).
- The legacy Supabase `project-docs` bucket is retired for this tab (not migrated).

## Decisions (from brainstorm)

| Question | Decision |
|----------|----------|
| Source of truth | **Dropbox is the single source.** Retire Supabase `project-docs` for this tab. |
| Browse model | **Navigable folder tree** rooted at `51 DOC`, breadcrumb nav. |
| Unnumbered files | **Always prompt** — `needs_review` until resolved as customer-supplied or assigned a number. |
| Viewing | **Native local open** via local helper endpoint (PacForge bridge), with fallback. |
| Fix scope | **Full rename/fix in-app** (assign-on-upload *and* fix existing files). |
| Architecture | **Approach A** — Dropbox-API-backed + deterministic pure doc-control lib. |

## The Numbering Convention (derived from the real folder)

Reference job: `…/Pac/Jobs/SRE Electrical/SRE-2601 - Herrenknecht/51 DOC/`

Sub-folders: `01 REFERENCE DOCS`, `02 PAC MANUALS`, `03 PLC CHANGELOG`,
`04 VARIATION REQUESTS`, `05 NETWORK ADDRESSES`, `06 VENDOR MANUALS`,
`07 VENDOR REFERENCE DOCS`, `10 ORDERS`.

A conforming Pac document is named:

```
{ProjectNumber}-{FF}{SS}{NNN} {version}[ - description].ext
```

- `{ProjectNumber}` — e.g. `SRE-2601` (matches `projects.project_number`).
- `FF` — **folder code**: the leading number of the documents folder itself (`51 DOC` → `51`).
- `SS` — **sub-folder code**: the leading number of the immediate sub-folder
  (`04 VARIATION REQUESTS` → `04`).
- `NNN` — 3-digit sequence, per sub-folder, zero-padded.
- `{version}` — e.g. `1.0` (preserved, not enforced in v1).

Example (conforming): `SRE-2601-5101001 1.0.xlsx` — project `SRE-2601`, folder `51`,
sub-folder `01`, seq `001`, version `1.0`.

### Why the rule is "folder code = leading number of the folder"

The reference folder contains real violations that this rule must catch generically:

| Filename | Location | Verdict | Reason |
|----------|----------|---------|--------|
| `SRE-2601-5101001 1.0.xlsx` | `51 DOC/01 …` | conforming | matches `51`+`01` and project number |
| `XXX-17XX-5003001 - 1.0 PLC CHANGELOG.xlsx` | `51 DOC/03 …` | non-conforming | placeholder `XXX-17XX` **and** folder code `50` ≠ `51` |
| `XXX-XXXX-5104001 - Variation Request Form.docx` | `51 DOC/04 …` | non-conforming | placeholder project number `XXX-XXXX` |
| `XXX-18XX-5110-XXX1801.docx` | `51 DOC/10 …` | non-conforming | placeholder + malformed tail |
| `Herrenknecht - Segment Wagon.pdf` | `51 DOC/01 …` | needs_review → customer-supplied | no number token |
| `SRL-Segment-Wagon-IO-List-v2.csv` | `51 DOC/01 …` | needs_review → customer-supplied | no number token |

Nothing project-specific is hardcoded: codes are read from the folder names at runtime, so
this works for any job (conveyors, filling stations, etc.), not just this example.

**Vendor folders auto-exempt:** files under `06 VENDOR MANUALS` and `07 VENDOR REFERENCE
DOCS` are treated as customer/vendor-supplied (exempt) by location, with no prompt.

## Architecture (Approach A)

```
project-detail.tsx (Documents tab)
  └─ <ProjectDocuments> (new component tree)
        ├─ useProjectDocs(project)            ← lists 51 DOC via edge fn `list-folder`
        ├─ doc-control.ts (pure)              ← parse / classify / next-seq / suggest-name
        ├─ useDocOverrides(projectId)         ← reads/writes project_doc_overrides
        ├─ useOpenLocalFile()                 ← POST bridge /open-file (fallback on fail)
        ├─ useUploadDoc() / useMoveDoc()      ← edge fn `upload-file` / NEW `move-file`
        └─ DropboxConnection / dropbox_folder_path gating
```

### Components

- **`src/lib/doc-control.ts`** — pure, deterministic, no React, no AI:
  - `parseDocNumber(filename) → { projectNumber, folderCode, subfolderCode, seq, version } | null`
    Tolerant token match; recognizes `XXX`/`XX`-style placeholders as "attempts the convention".
  - `folderCodeFromName(name) → string | null` — leading digits of a folder name.
  - `classifyDoc({ filename, folderCode, subfolderCode, projectNumber, isVendorFolder, hasOverride })`
    → `{ state, reasons[], suggestedName? }` where `state ∈
    { conforming, non_conforming, needs_review, customer_supplied }`.
  - `nextSequence(entries, folderCode, subfolderCode) → string` (max existing +1, 3-digit).
  - `buildDocNumber({ projectNumber, folderCode, subfolderCode, seq, version })` and
    `suggestFilename(original, parts)` — preserve extension + trailing description, default
    version `1.0`.

- **`src/hooks/use-project-docs.ts`** — TanStack Query wrapper over the `dropbox` edge
  function: list folder, upload, move. Derives the `51 DOC` API path from
  `project.dropbox_folder_path` + `dropboxRoot` (ui-store) via `toDropboxApiPath()`.

- **`src/hooks/use-doc-overrides.ts`** — CRUD over `project_doc_overrides`.

- **`src/hooks/use-open-local-file.ts`** — POST to bridge `/open-file`; on failure exposes
  `fallback` (copy path + open-in-Dropbox-web).

- **UI under `src/components/project-documents/`** — folder tree, breadcrumb, conformance
  summary bar, file rows with status badges + actions, upload dialog, resolve dialog.

### Plumbing additions

- **Edge function `supabase/functions/dropbox/index.ts`**: add `move-file` action wrapping
  Dropbox `/files/move_v2` (`{ from_path, to_path }`). Used for both *fix non-conforming*
  and *assign number*.
- **PacForge bridge**: add `POST /open-file` `{ path }` → `Process.Start(new
  ProcessStartInfo(path){ UseShellExecute = true })`. **Guarded**: only opens paths under the
  configured Dropbox root; rejects otherwise. Bridge unreachable → UI fallback, never a dead
  button.

### Data: `project_doc_overrides` (new migration)

```sql
create table project_doc_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  rel_path text not null,              -- e.g. "51 DOC/01 REFERENCE DOCS/Herrenknecht - Segment Wagon.pdf"
  classification text not null check (classification in ('customer_supplied')),
  note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz not null default now(),
  unique (project_id, rel_path)
);
-- RLS: same project-visibility policy as other project-scoped tables.
```

Only stores **customer-supplied exemptions**. A file renamed to a valid number becomes
conforming by parse and needs no row. Orphaned rows (file later moved/renamed) simply
stop matching and the file re-prompts.

## Data Flow

**Listing & classification (read):**
1. Resolve `51 DOC` API path from `dropbox_folder_path` + `dropboxRoot`.
2. `list-folder` for the current tree node.
3. For each file: `classifyDoc()` using the current folder/sub-folder codes, project number,
   vendor-folder flag, and whether an override row exists.
4. Render badges + summary counts.

**Fix non-conforming:** show current vs `suggestedName` → confirm → `move-file`
(rename in place) → invalidate list.

**Resolve needs-review:** *Mark customer-supplied* → insert override row; or *Assign Pac
number* → compute `nextSequence` → `move-file` to suggested name → becomes conforming.

**Upload:** pick file → choose Pac-controlled (auto-name via `nextSequence` for current
sub-folder) or Customer-supplied (upload as-is + insert override) → `upload-file`.

**Open:** POST bridge `/open-file` with the local path
(`dropboxRoot` + rel path). On failure → fallback (copy path / Dropbox web).

## Error Handling & Edge States

- No `dropbox_folder_path` → prompt to set the job folder (reuse `dropbox-folder-dialog`).
- No Dropbox connection → prompt to connect (`useDropboxConnect`).
- No `51 DOC` sub-folder → offer to create it via `create-folder-path`.
- File directly under `51 DOC` (not in a numbered sub-folder) → `needs_review`
  (no sub-folder code to validate against).
- Dropbox API/rate-limit errors → surfaced via toast; list stays usable.
- Bridge down → local-open falls back; all other actions unaffected.

## Testing

- **`doc-control.test.ts`** — exhaustive unit suite using the **real SRE-2601 filenames** as
  fixtures: the conforming `SRE-2601-5101001`, each `XXX`/`50` violation, the customer PDFs,
  vendor-folder exemption, sequence derivation, and `suggestFilename` round-trips. Also
  a couple of *different-shaped* projects (different prefix/codes) to prove genericity.
- Thin integration coverage for the edge `move-file` action and bridge `/open-file` guard
  (rejects paths outside the Dropbox root).

## Open follow-ups (not v1)

- Revision/version control (enforce `_RevNN` progression, supersede prior revs).
- Bulk fix-all for non-conforming files.
- Surfacing doc-control status on the projects list / a job-level "doc health" indicator.
