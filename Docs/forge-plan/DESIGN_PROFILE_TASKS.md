# Design Profile Enforcement — Claude Code Tasks

## Overview

The `DesignProfile` object controls per-client PLC code standards. Several fields are stored in
Supabase but never injected into AI prompts, and different generation paths use inconsistent
helpers to format the profile. This task set fixes that.

**Read `CLAUDE.md` first** — especially the "Four Generation Paths" section. Every prompt builder
change must be verified against all four paths.

---

## Background: How the Profile Currently Works

- `src/types/design-profile.ts` — defines `DesignProfile` interface
- `src/lib/prompt-builder.ts` — exports `formatDesignProfile(profile, context)` — the canonical,
  most complete formatter. Used by Pac-ST pipeline path only.
- `src/lib/forge-prompts.ts` — has its own local `formatProfile()` that only reads
  `profile.general_rules`. Misses `folder_rules`, `process_rules`, `fb_rules`,
  `naming_prefix`, `db_naming_prefix`.
- `src/lib/compile-fix-prompt.ts` — injects profile using the legacy `profile.rules` field only.
- `src/lib/lad-prompt-builder.ts` — no design profile support at all.
- `naming_prefix` and `db_naming_prefix` fields on `DesignProfile` are never read by any prompt
  builder despite being stored in the DB.

**Do not change any Supabase schema or migrations.** All required columns already exist.

---

## Task 1 — Inject `naming_prefix` and `db_naming_prefix` into prompts

**File:** `src/lib/prompt-builder.ts`

**Problem:** `naming_prefix` (e.g. `FB_CK_`) and `db_naming_prefix` (e.g. `DB_CK_`) exist on
`DesignProfile` and are stored in Supabase but are never read by `formatDesignProfile()` or any
other prompt builder.

**Change:** In `formatDesignProfile()`, after the `generalRules` section is pushed onto `sections`,
add a new section for naming prefixes when either field is non-empty:

```ts
if (profile.naming_prefix?.trim() || profile.db_naming_prefix?.trim()) {
  const namingLines: string[] = [];
  if (profile.naming_prefix?.trim()) {
    namingLines.push(
      `- RULE: FB and FC block names MUST use the prefix \`${profile.naming_prefix}\`` +
      ` (e.g. \`${profile.naming_prefix}Motor\`, \`${profile.naming_prefix}Sensor\`).` +
      ` Do NOT generate blocks without this prefix.`
    );
  }
  if (profile.db_naming_prefix?.trim()) {
    namingLines.push(
      `- RULE: DB block names MUST use the prefix \`${profile.db_naming_prefix}\`` +
      ` (e.g. \`${profile.db_naming_prefix}Motor\`, \`${profile.db_naming_prefix}Sensors\`).` +
      ` Do NOT generate DBs without this prefix.`
    );
  }
  sections.push(`### Naming Prefix Rules (MANDATORY)\n\n${namingLines.join('\n')}`);
}
```

**Verify:** `formatDesignProfile()` is called from multiple places. This change applies
automatically to all of them. Run `npm run build` — no type errors expected.

---

## Task 2 — Replace degraded `formatProfile()` in `forge-prompts.ts`

**File:** `src/lib/forge-prompts.ts`

**Problem:** This file defines its own `formatProfile(profile)` function (search for
`function formatProfile`) that only reads `profile.general_rules`. It ignores `folder_rules`,
`process_rules`, `fb_rules`, `naming_prefix`, and `db_naming_prefix`.

**Change:**

1. Add this import at the top of the file (with other imports):
   ```ts
   import { formatDesignProfile } from '@/lib/prompt-builder';
   ```

2. Delete the local `formatProfile()` function entirely.

3. Replace every call to `formatProfile(profile)` or `formatProfile(context.profile)` with
   `formatDesignProfile(profile, context)` where `context` is determined by what each call site
   is generating:

   | What the call site generates | Context to pass |
   |------------------------------|-----------------|
   | Device FB generation         | `'fb'`          |
   | Process / sequence code      | `'process'`     |
   | IO linking FC                | `'general'`     |
   | QA / review prompts          | `'all'`         |
   | Everything else              | `'general'`     |

   To find all call sites: `grep -n "formatProfile(" src/lib/forge-prompts.ts`

   The variable holding the profile at each call site may be named `profile` or
   `context.profile` — check each one and use the correct variable name.

**Verify:** `npm run build` with no type errors. The function signature of `formatDesignProfile`
is `(profile: DesignProfile, context?: "general" | "process" | "fb" | "all") => string` — the
context parameter is optional and defaults to `"general"` if omitted.

---

## Task 3 — Fix profile injection in `compile-fix-prompt.ts`

**File:** `src/lib/compile-fix-prompt.ts`

**Problem:** The compile-fix system prompt injects the design profile using a ternary that reads
`designProfile?.rules?.trim()` — the legacy field. This misses all newer fields.

**Change:**

1. Add this import:
   ```ts
   import { formatDesignProfile } from '@/lib/prompt-builder';
   ```

2. Find the block that reads `designProfile?.rules?.trim()` (a ternary or if-check, around
   line 66). Replace it with:
   ```ts
   ${designProfile ? formatDesignProfile(designProfile, 'general') : ''}
   ```

**Verify:** `npm run build`. The compile-fix path is `use-compile-fix.ts` →
`buildCompileFixSystemPrompt()`. Confirm the function signature still accepts
`designProfile?: DesignProfile`.

---

## Task 4 — Add design profile to `lad-prompt-builder.ts`

**File:** `src/lib/lad-prompt-builder.ts`

**Problem:** LAD (Ladder Diagram) generation is completely blind to the design profile. Client
naming conventions and folder rules are not applied to LAD code.

**Change:**

1. Add imports at the top:
   ```ts
   import type { DesignProfile } from '@/types';
   import { formatDesignProfile } from '@/lib/prompt-builder';
   ```

2. Find the `buildLadSystemPrompt()` function signature. Add `designProfile?: DesignProfile`
   as a parameter. It already accepts `agentKnowledgeDocs` and `referenceSections` — add
   `designProfile` alongside them.

3. In the returned template string, inject the profile after the existing knowledge/reference
   blocks:
   ```ts
   ${designProfile ? formatDesignProfile(designProfile, 'general') : ''}
   ```

4. Find all call sites of `buildLadSystemPrompt()`. Run:
   ```
   grep -rn "buildLadSystemPrompt" src/
   ```
   Likely in `src/hooks/use-lad-generate.ts`. At each call site, pass the `designProfile`
   through. The hook will need to fetch it — check how nearby hooks fetch it:
   ```ts
   const { data: designProfile } = useDesignProfile(project?.design_profile_id ?? undefined);
   ```
   Add the same pattern to `use-lad-generate.ts` if it does not already have it, then pass
   `designProfile` into `buildLadSystemPrompt()`.

**Verify:** `npm run build`. No regressions in the LAD generation flow.

---

## Task 5 — Add `FolderRulesSchema` type and structured rendering to `formatDesignProfile`

This task adds support for a structured JSON schema in the `folder_rules` field. The profile
editor UI (Task 6) will write this format. The prompt builder must render it unambiguously.

**Step 5a — Add the type**

**File:** `src/types/design-profile.ts`

Add the following interface **before** the `DesignProfile` interface:

```ts
export interface FolderRulesSchema {
  version: 2;
  pattern: 'section_per_area' | 'flat' | 'custom';
  shared_device_group: boolean;
  device_group_name: string;
  device_subfolders: {
    fbs: string;
    dbs: string;
    call_fcs_at_root: boolean;
  };
  section_groups: string[];
  other_root_groups: string[];
  call_fc_rules: {
    one_fc_per_device_type: boolean;
    one_network_per_instance: boolean;
    networks_contain_wiring_only: boolean;
  };
  custom_notes: string;
}
```

**Step 5b — Add schema renderer to prompt builder**

**File:** `src/lib/prompt-builder.ts`

1. Add this import at the top:
   ```ts
   import type { FolderRulesSchema } from '@/types/design-profile';
   ```

2. Add this helper function before `formatDesignProfile()`:

```ts
function renderFolderRulesFromSchema(schema: FolderRulesSchema): string {
  const rules: string[] = [];

  if (schema.pattern === 'section_per_area') {
    rules.push(
      '- RULE: Each area/section of the plant MUST have its own top-level program block group' +
      ' (e.g. CONVEYORS, ELEVATORS, DIMENSIONNERS). Do NOT mix sections into a single group.'
    );
  }

  if (schema.shared_device_group) {
    rules.push(
      `- RULE: ALL device FBs, instance DBs, and call FCs MUST be placed in a single shared` +
      ` group named "${schema.device_group_name}" at the root level — NOT inside per-section groups.`
    );
    rules.push(
      `- RULE: Inside "${schema.device_group_name}":` +
      ` FBs go in subfolder "${schema.device_subfolders.fbs}",` +
      ` DBs go in subfolder "${schema.device_subfolders.dbs}".`
    );
    if (schema.device_subfolders.call_fcs_at_root) {
      rules.push(
        `- RULE: Call FCs (CALL_MOTOR, CALL_SENSOR, etc.) are placed directly at the root` +
        ` of "${schema.device_group_name}", NOT inside any subfolder.`
      );
    }
  }

  if (schema.call_fc_rules.one_fc_per_device_type) {
    rules.push(
      '- RULE: Generate exactly ONE call FC per device type (e.g. CALL_MOTOR, CALL_SENSOR,' +
      ' CALL_VALVE). Do NOT combine multiple device types in a single call FC.'
    );
  }
  if (schema.call_fc_rules.one_network_per_instance) {
    rules.push(
      '- RULE: Each call FC MUST contain exactly ONE network per device instance.' +
      ' Each network calls the FB via its instance DB with ALL parameters explicitly wired.'
    );
  }
  if (schema.call_fc_rules.networks_contain_wiring_only) {
    rules.push(
      '- RULE: Call FC networks contain ONLY the FB call with parameter wiring.' +
      ' No logic, no conditions, no branching — parameter wiring only.'
    );
  }

  if (schema.section_groups?.length > 0) {
    rules.push(
      `- RULE: The following section groups MUST exist at root level:` +
      ` ${schema.section_groups.map(g => `"${g}"`).join(', ')}.`
    );
  }

  if (schema.other_root_groups?.length > 0) {
    rules.push(
      `- RULE: The following utility/system groups MUST also exist at root level:` +
      ` ${schema.other_root_groups.map(g => `"${g}"`).join(', ')}.`
    );
  }

  if (schema.custom_notes?.trim()) {
    rules.push(`\nAdditional folder/structure notes:\n${schema.custom_notes}`);
  }

  return rules.join('\n');
}
```

3. In `formatDesignProfile()`, find the existing `folder_rules` section push. Replace it with
   schema-aware rendering:

```ts
if (profile.folder_rules?.trim()) {
  let folderSection: string;
  try {
    const parsed = JSON.parse(profile.folder_rules);
    if (parsed?.version === 2) {
      folderSection = renderFolderRulesFromSchema(parsed as FolderRulesSchema);
    } else {
      folderSection = profile.folder_rules;
    }
  } catch {
    // Legacy freetext — use as-is
    folderSection = profile.folder_rules;
  }
  sections.push(`### Program Folder Structure\n\n${folderSection}`);
}
```

**Verify:** `npm run build`. Existing profiles with freetext `folder_rules` still work via the
fallback. New schema format is rendered as unambiguous RULE statements.

---

## Task 6 — Structured folder rules editor in the profile UI

**File:** `src/routes/profile-detail.tsx`

**Problem:** The "Folders" tab shows a freetext `<Textarea>` for `folder_rules`. This is
ambiguous — engineers describe structure in natural language rather than defining exact rules.

**Change:** Replace the freetext textarea in the "Folders" tab with a structured form. Keep
a "Raw JSON" expander for power users.

All UI components needed already exist in the project: `Input`, `Switch`, `Label`, `Button`,
`Badge`, `Separator`, `Textarea` from `@/components/ui/`.

**Step 6a — Add helper functions** (add these inside the component file, before the component):

```ts
import type { FolderRulesSchema } from '@/types/design-profile';

const DEFAULT_FOLDER_SCHEMA: FolderRulesSchema = {
  version: 2,
  pattern: 'section_per_area',
  shared_device_group: true,
  device_group_name: 'DEVICE',
  device_subfolders: { fbs: 'FB', dbs: 'DB', call_fcs_at_root: true },
  section_groups: [],
  other_root_groups: ['OB', 'IO_MAPPING', 'DATA_MGMT', 'SAFETY', 'SYS'],
  call_fc_rules: {
    one_fc_per_device_type: true,
    one_network_per_instance: true,
    networks_contain_wiring_only: true,
  },
  custom_notes: '',
};

function parseFolderSchema(raw: string | null | undefined): FolderRulesSchema {
  if (!raw?.trim()) return { ...DEFAULT_FOLDER_SCHEMA };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) return parsed as FolderRulesSchema;
  } catch { /* fall through */ }
  // Legacy freetext — return default, preserve text in custom_notes
  return { ...DEFAULT_FOLDER_SCHEMA, custom_notes: raw };
}
```

**Step 6b — Add local state for the schema** in the component body alongside the other state
declarations:

```ts
const [folderSchema, setFolderSchema] = useState<FolderRulesSchema | null>(null);
const [showRawFolderJson, setShowRawFolderJson] = useState(false);
```

Initialise `folderSchema` from the profile in the same `useEffect` or initialisation pattern
used for the other fields (e.g. `generalRules`, `folderRules`).

When `folderSchema` changes, keep `folderRules` state in sync:
```ts
// whenever folderSchema changes, sync it back to the string field used by save
setFolderRules(JSON.stringify(folderSchema, null, 2));
setDirty(true);
```

**Step 6c — Replace the folder rules textarea** with a structured form. Find the section in
the JSX that renders the "folders" tab content (search for `tab === "folders"`). Replace the
`<Textarea>` with:

```tsx
{folderSchema && (
  <div className="space-y-6">

    {/* Pattern */}
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Folder Pattern
      </Label>
      <Select
        value={folderSchema.pattern}
        onValueChange={v => setFolderSchema(s => s && ({
          ...s, pattern: v as FolderRulesSchema['pattern']
        }))}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="section_per_area">Section per area</SelectItem>
          <SelectItem value="flat">Flat (no sections)</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Shared device group */}
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Shared Device Group
        </Label>
        <Switch
          checked={folderSchema.shared_device_group}
          onCheckedChange={v => setFolderSchema(s => s && ({ ...s, shared_device_group: v }))}
        />
      </div>
      {folderSchema.shared_device_group && (
        <div className="space-y-3 pl-3 border-l border-border">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Group name</Label>
            <Input
              value={folderSchema.device_group_name}
              onChange={e => setFolderSchema(s => s && ({ ...s, device_group_name: e.target.value }))}
              placeholder="DEVICE"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">FB subfolder</Label>
              <Input
                value={folderSchema.device_subfolders.fbs}
                onChange={e => setFolderSchema(s => s && ({
                  ...s, device_subfolders: { ...s.device_subfolders, fbs: e.target.value }
                }))}
                placeholder="FB"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">DB subfolder</Label>
              <Input
                value={folderSchema.device_subfolders.dbs}
                onChange={e => setFolderSchema(s => s && ({
                  ...s, device_subfolders: { ...s.device_subfolders, dbs: e.target.value }
                }))}
                placeholder="DB"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Call FCs at group root (not in subfolder)</Label>
            <Switch
              checked={folderSchema.device_subfolders.call_fcs_at_root}
              onCheckedChange={v => setFolderSchema(s => s && ({
                ...s, device_subfolders: { ...s.device_subfolders, call_fcs_at_root: v }
              }))}
            />
          </div>
        </div>
      )}
    </div>

    {/* Call FC rules */}
    <div className="space-y-3">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Call FC Rules
      </Label>
      {[
        { key: 'one_fc_per_device_type', label: 'One FC per device type' },
        { key: 'one_network_per_instance', label: 'One network per device instance' },
        { key: 'networks_contain_wiring_only', label: 'Networks contain wiring only (no logic)' },
      ].map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          <Switch
            checked={folderSchema.call_fc_rules[key as keyof typeof folderSchema.call_fc_rules]}
            onCheckedChange={v => setFolderSchema(s => s && ({
              ...s, call_fc_rules: { ...s.call_fc_rules, [key]: v }
            }))}
          />
        </div>
      ))}
    </div>

    {/* Section groups */}
    <FolderGroupEditor
      label="Section Groups"
      hint="e.g. CONVEYORS, ELEVATORS, SAFETY"
      values={folderSchema.section_groups}
      onChange={v => setFolderSchema(s => s && ({ ...s, section_groups: v }))}
    />

    {/* Other root groups */}
    <FolderGroupEditor
      label="Other Root Groups"
      hint="e.g. OB, IO_MAPPING, DATA_MGMT, SYS"
      values={folderSchema.other_root_groups}
      onChange={v => setFolderSchema(s => s && ({ ...s, other_root_groups: v }))}
    />

    {/* Custom notes */}
    <div className="space-y-1">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Custom Notes
      </Label>
      <Textarea
        value={folderSchema.custom_notes}
        onChange={e => setFolderSchema(s => s && ({ ...s, custom_notes: e.target.value }))}
        placeholder="Any additional folder/structure rules not covered above..."
        className="font-mono text-xs min-h-[80px]"
      />
    </div>

    {/* Raw JSON toggle */}
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setShowRawFolderJson(v => !v)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showRawFolderJson ? 'Hide' : 'Show'} raw JSON
      </button>
      {showRawFolderJson && (
        <Textarea
          value={JSON.stringify(folderSchema, null, 2)}
          onChange={e => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (parsed?.version === 2) setFolderSchema(parsed);
            } catch { /* ignore invalid JSON while typing */ }
          }}
          className="font-mono text-xs mt-2 min-h-[200px]"
        />
      )}
    </div>

  </div>
)}
```

**Step 6d — Add the `FolderGroupEditor` helper component** (add this as a local component in
`profile-detail.tsx`, below the imports, before the main `ProfileDetailPage` component):

```tsx
function FolderGroupEditor({
  label, hint, values, onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1 min-h-[28px]">
        {values.map(v => (
          <Badge key={v} variant="secondary" className="font-mono text-xs gap-1">
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter(x => x !== v))}
              className="hover:text-destructive"
            >×</button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter' && input.trim()) {
              e.preventDefault();
              if (!values.includes(input.trim())) onChange([...values, input.trim()]);
              setInput('');
            }
          }}
          placeholder={hint}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (input.trim() && !values.includes(input.trim())) {
              onChange([...values, input.trim()]);
              setInput('');
            }
          }}
        >Add</Button>
      </div>
    </div>
  );
}
```

**Verify:** Start dev server (`npm run dev`), navigate to Profiles → any profile → Folders tab.
The structured form should render. Toggling switches and adding groups should update the raw JSON
toggle. Saving should persist the JSON string to the DB. Existing profiles with freetext
`folder_rules` should migrate gracefully (their text moves to the custom_notes field via
`parseFolderSchema()`).

---

## Final Verification Checklist

After all tasks are complete:

1. `npm run build` — zero TypeScript errors
2. `npm run lint` — zero lint errors  
3. Navigate to Profiles → create a new profile with `naming_prefix = "FB_CK_"` and
   `db_naming_prefix = "DB_CK_"` — verify `formatDesignProfile()` output includes the RULE
   statements (add a temporary `console.log` or check in prompt preview if one exists)
4. Folders tab — verify structured form renders, values save, raw JSON toggle works, legacy
   freetext profiles load without crashing
5. `grep -rn "formatProfile(" src/lib/forge-prompts.ts` — should return zero results (all
   replaced in Task 2)
6. `grep -rn "\.rules" src/lib/compile-fix-prompt.ts` — should return zero results for the
   old legacy injection (replaced in Task 3)
7. Confirm `buildLadSystemPrompt` in `lad-prompt-builder.ts` now accepts `designProfile`
   parameter and that all call sites pass it through

---

## Files Changed Summary

| File | Task | Change |
|------|------|--------|
| `src/types/design-profile.ts` | 5a | Add `FolderRulesSchema` interface |
| `src/lib/prompt-builder.ts` | 1, 5b | Inject `naming_prefix`/`db_naming_prefix`; add schema renderer; schema-aware folder rendering |
| `src/lib/forge-prompts.ts` | 2 | Remove local `formatProfile()`, use shared `formatDesignProfile()` with correct context per call site |
| `src/lib/compile-fix-prompt.ts` | 3 | Replace legacy `rules` field injection with `formatDesignProfile()` |
| `src/lib/lad-prompt-builder.ts` | 4 | Add `DesignProfile` parameter, inject via `formatDesignProfile()` |
| `src/hooks/use-lad-generate.ts` | 4 | Fetch `designProfile` and pass to `buildLadSystemPrompt()` |
| `src/routes/profile-detail.tsx` | 6 | Replace folder rules textarea with structured schema editor |
