# TASK: Fix FB Library Template Matching

## Context

Pac-Forge uses a scoring system to match extracted spec devices to FB library templates.
Library templates (source = "library", e.g. fbMotor_Reversing, fbVFD_GSeries) consistently
lose to custom templates in scoring due to three bugs. This task fixes all three.

---

## Files to modify

1. `src/lib/forge-device-matcher.ts` — core scoring logic (Fixes 1, 2, 3b)
2. `src/hooks/use-forge-ai-device-match.ts` — AI matching path (Fix 3a)
3. `src/routes/forge.tsx` — template fetch hook (Fix 4)

Do NOT modify any other files. Do NOT change the public API signatures of any exported
functions. Do NOT change type definitions.

---

## Fix 1 — Library-aware name tokenisation in `nameAffinity()`

**File:** `src/lib/forge-device-matcher.ts`

**Problem:** Library FB names like `fbMotor_Reversing` score 0 on name affinity because:
- `normalise("fbMotor_Reversing")` = `"fbmotorreversing"`
- `normalise("Motor DOL")` = `"motordol"`
- `"fbmotorreversing".includes("motordol")` = false → score 0.0

The `fb` prefix and CamelCase/underscore structure prevent any substring match.

**Fix:** Add a helper `tokeniseTemplateName(name: string): string[]` that:
1. Strips a leading `fb`, `fc`, or `udt` prefix (case-insensitive)
2. Splits on underscores AND CamelCase boundaries
3. Returns lowercase tokens

Example: `"fbMotor_Reversing"` → `["motor", "reversing"]`
Example: `"fbVFD_GSeries"` → `["vfd", "g", "series"]`
Example: `"ControlMotor"` → `["control", "motor"]`

Then in `nameAffinity()`, after all existing checks fail, add a token overlap check:

```typescript
// Token overlap — handles library FB naming conventions (fb prefix, CamelCase, underscores)
const templateTokens = tokeniseTemplateName(template.name);
const deviceTokens = deviceType.toLowerCase().split(/[\s_\-/]+/).filter(w => w.length >= 2);
if (templateTokens.length > 0 && deviceTokens.length > 0) {
  const overlap = deviceTokens.filter(w => templateTokens.includes(w));
  if (overlap.length > 0) {
    const ratio = overlap.length / deviceTokens.length;
    // Return score proportional to overlap, max 0.55 (below synonym exact match of 1.0,
    // below category substring of 0.6, but above tag match of 0.3)
    return Math.min(0.55, 0.3 + ratio * 0.25);
  }
}
```

This goes AFTER the existing tag check (score 0.3) and BEFORE the final `return 0.0`.

The tokeniser implementation:

```typescript
function tokeniseTemplateName(name: string): string[] {
  // Strip leading fb/fc/udt prefix
  const stripped = name.replace(/^(fb|fc|udt)/i, "");
  // Split on underscores, then split CamelCase words
  return stripped
    .split("_")
    .flatMap(part => part.split(/(?<=[a-z])(?=[A-Z])/))
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2);
}
```

---

## Fix 2 — Source boost for library templates

**File:** `src/lib/forge-device-matcher.ts`

**Problem:** `source` field is never used in scoring. Library templates have tested code +
HMI faceplates, so they should be preferred over custom templates at equal scores.

**Fix:** In `scoreTemplate()`, after computing `combined`, apply a boost:

```typescript
// Library templates have tested code + matched HMI faceplates — prefer them
const sourceBoost = template.source === "library" ? 0.08 : 0;
const combined = hasScl
  ? Math.min(1.0, 0.4 * iScore + 0.3 * nScore + 0.3 * sScore + sourceBoost)
  : Math.min(1.0, 0.5 * nScore + 0.5 * sScore + sourceBoost);
```

Cap at 1.0. The boost is 0.08 (not 0.1) to avoid pushing borderline "probable" matches
to "exact" when name affinity is still weak.

---

## Fix 3a — Documentation fallback in AI matching path

**File:** `src/hooks/use-forge-ai-device-match.ts`

**Problem:** Library templates with no `ai_summary` are presented to the AI as
`"(no summary — match by name/category only)"` which gives Claude almost nothing
to reason about, especially with obscure library naming conventions.

**Fix:** In the template list construction (the `.map()` that builds `templateList`),
use the first 300 characters of `documentation` as a fallback when `ai_summary` is null:

```typescript
const templateList = templates
  .map((t) => {
    const summary = t.ai_summary
      ?? (t.documentation ? t.documentation.slice(0, 300).replace(/\s+/g, " ").trim() + "…" : null)
      ?? "(no summary)";
    return `ID: ${t.id}\nName: ${t.name}\nCategory: ${t.device_category}\nSource: ${t.source}\nSummary: ${summary}`;
  })
  .join("\n\n---\n\n");
```

Note also: add `Source: ${t.source}` to the template description so Claude knows which
are library vs custom — this helps Claude prefer library templates when both would work.

---

## Fix 3b — Documentation fallback in heuristic `summaryAffinity()`

**File:** `src/lib/forge-device-matcher.ts`

**Problem:** `summaryAffinity()` only checks `template.ai_summary`. For library templates
imported before auto-generation was added, `ai_summary` is null, so sScore = 0.

**Fix:** In `summaryAffinity()`, fall back to the first 500 chars of `documentation`:

```typescript
function summaryAffinity(deviceType: string, template: FbTemplate): number {
  const summary = (template.ai_summary
    ?? template.documentation?.slice(0, 500)
    ?? "").toLowerCase();
  if (!summary) return 0;
  // ... rest of function unchanged
}
```

---

## Fix 4 — Use correct template fetch hook in forge.tsx

**File:** `src/routes/forge.tsx`

**Problem:** Line 105 calls `useFbTemplates()` (unfiltered, no `is_enabled` check).
The correct hook for the forge pipeline is `useFbTemplatesForSession(profileId)`.

**Fix:**

1. Import `useFbTemplatesForSession` (it is already exported from `src/hooks/use-fb-templates.ts`)
2. Find where `profileId` is available in `forge.tsx` — it comes from the active session's
   `design_profile_id`. Check what the session store exposes. If `profileId` is not directly
   available at the route level, pass `undefined` to `useFbTemplatesForSession` for now
   (which will still apply the `is_enabled` filter, which is the important part).
3. Replace:
   ```typescript
   const { data: fbTemplates = [], refetch: refetchFbTemplates } = useFbTemplates();
   ```
   With:
   ```typescript
   const { data: fbTemplates = [], refetch: refetchFbTemplates } = useFbTemplatesForSession(profileId);
   ```
   Where `profileId` is resolved from the session, or `undefined` if not available.

**Important:** Do NOT remove the `useFbTemplates` import if it is used elsewhere in the
file. Check before removing.

---

## Verification checklist

After making all changes, verify:

1. `forge-device-matcher.ts` compiles with no TypeScript errors
2. `tokeniseTemplateName("fbMotor_Reversing")` returns `["motor", "reversing"]`
3. `tokeniseTemplateName("fbVFD_GSeries")` returns `["vfd", "g", "series"]`
4. `nameAffinity("Motor DOL", { name: "fbMotor_Reversing", ... })` returns > 0.3
5. `nameAffinity("Motor VFD", { name: "fbVFD_GSeries", ... })` returns > 0.3
6. A library template scores at least 0.08 higher than an otherwise identical custom template
7. `summaryAffinity()` does not throw when both `ai_summary` and `documentation` are null
8. `forge.tsx` compiles with no TypeScript errors
9. No existing tests break (run `npm run typecheck` or equivalent)

---

## Constraints

- Do not change the `DeviceFbMatch`, `TemplateScore`, or `FbInterface` type shapes
- Do not change exported function signatures
- Do not add new npm dependencies
- Keep the existing `DEVICE_TYPE_SYNONYMS` table — Fix 1 supplements it, does not replace it
- The `scoreTemplate()` function must still return a `TemplateScore` with `iScore`, `nScore`,
  `sScore`, and `combined` fields — the `combined` field should reflect the boosted value
