# TASK 01: Fix FB Library Template Matching

## Background

The FB matcher scores each template against each device and picks the best fit.
Library templates (source = "library") consistently lose to custom templates because:

1. Library FB names like `fbMotor_Reversing` score 0 on name affinity — the `fb` prefix
   and CamelCase/underscore structure prevent any substring match against "Motor DOL".
2. The `source` field is never used — library templates get no preference despite having
   tested LAD code and matched HMI faceplates.
3. `summaryAffinity()` only checks `ai_summary` — for templates imported before
   auto-generation was added, this is null, so sScore = 0.
4. The AI matching path presents library templates with no summary as
   "(no summary — match by name/category only)" giving Claude nothing to reason about.
5. `forge.tsx` calls `useFbTemplates()` (unfiltered) instead of
   `useFbTemplatesForSession()` (respects `is_enabled` + profile filtering).

---

## Files to modify

1. `src/lib/forge-device-matcher.ts`
2. `src/hooks/use-forge-ai-device-match.ts`
3. `src/routes/forge.tsx`

Do NOT modify type definitions. Do NOT change exported function signatures.
Do NOT add new npm dependencies.

---

## Fix 1 — Token-based name matching for library FB naming conventions

**File:** `src/lib/forge-device-matcher.ts`

**Problem:** `normalise("fbMotor_Reversing")` = `"fbmotorreversing"`,
`normalise("Motor DOL")` = `"motordol"`. No substring overlap → nScore = 0.

**Add this helper** (place near the top of the name affinity section, before `nameAffinity`):

```typescript
/**
 * Tokenise a template name for library-aware matching.
 * Strips fb/fc/udt prefix, splits on underscores and CamelCase boundaries.
 * "fbMotor_Reversing" → ["motor", "reversing"]
 * "fbVFD_GSeries"     → ["vfd", "gseries"]
 * "ControlMotor"      → ["control", "motor"]
 */
function tokeniseTemplateName(name: string): string[] {
  const stripped = name.replace(/^(fb|fc|udt)/i, "");
  return stripped
    .split("_")
    .flatMap(part => part.split(/(?<=[a-z])(?=[A-Z])/))
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2);
}
```

**Modify `nameAffinity()`** — add a token overlap check AFTER the existing tag check
(score 0.3) and BEFORE the final `return 0.0`:

```typescript
  // Token overlap — handles library FB naming (fb prefix, CamelCase, underscores)
  // e.g. "fbMotor_Reversing" tokens ["motor","reversing"] vs device "Motor DOL" → "motor" overlaps
  const templateTokens = tokeniseTemplateName(template.name);
  const deviceTokens = deviceType.toLowerCase().split(/[\s_\-/]+/).filter(w => w.length >= 2);
  if (templateTokens.length > 0 && deviceTokens.length > 0) {
    const overlap = deviceTokens.filter(w => templateTokens.includes(w));
    if (overlap.length > 0) {
      const ratio = overlap.length / deviceTokens.length;
      // Max 0.55: below category substring (0.6) but above tag match (0.3)
      return Math.min(0.55, 0.3 + ratio * 0.25);
    }
  }

  return 0.0;
```

---

## Fix 2 — Source boost for library templates

**File:** `src/lib/forge-device-matcher.ts`

**Problem:** `source` is never used in scoring. Library templates should be preferred
at equal scores — they have tested code + matched HMI faceplates.

**Modify `scoreTemplate()`** — after computing the raw combined score, apply a boost
and cap at 1.0. The existing `sScore` line in the return is missing from the object —
also fix that:

```typescript
export function scoreTemplate(device: ForgeDeviceEntry, template: FbTemplate): TemplateScore {
  const iface = templateInterface(template);
  const iScore = interfaceScore(device, iface);
  const nScore = nameAffinity(device.device_type, template);
  const sScore = summaryAffinity(device.device_type, template);

  const hasScl = (template.blocks?.length ?? 0) > 0;
  // Library templates have tested code + matched HMI faceplates — prefer them
  const sourceBoost = template.source === "library" ? 0.08 : 0;

  const combined = hasScl
    ? Math.min(1.0, 0.4 * iScore + 0.3 * nScore + 0.3 * sScore + sourceBoost)
    : Math.min(1.0, 0.5 * nScore + 0.5 * sScore + sourceBoost);

  return { template, iScore, nScore, sScore, combined };
}
```

Note: the existing code has `return { template, iScore, nScore, combined }` which is
missing `sScore`. Fix that too (add `sScore` to the return object).

---

## Fix 3 — Documentation fallback in `summaryAffinity()`

**File:** `src/lib/forge-device-matcher.ts`

**Problem:** `summaryAffinity()` returns 0 when `ai_summary` is null, even if
`documentation` is populated with full manufacturer docs.

**Replace the existing `summaryAffinity()` function:**

```typescript
function summaryAffinity(deviceType: string, template: FbTemplate): number {
  // Fall back to first 500 chars of documentation if no AI summary
  const summary = (
    template.ai_summary ??
    template.documentation?.slice(0, 500) ??
    ""
  ).toLowerCase();
  if (!summary) return 0;

  const deviceWords = deviceType.toLowerCase().split(/[\s_\-/]+/).filter(w => w.length >= 3);
  if (deviceWords.length === 0) return 0;

  const matches = deviceWords.filter(w => summary.includes(w));
  return matches.length / deviceWords.length;
}
```

---

## Fix 4 — Documentation fallback in AI matching path

**File:** `src/hooks/use-forge-ai-device-match.ts`

**Problem:** Library templates with no `ai_summary` are presented as
"(no summary — match by name/category only)" — Claude has almost nothing to work with.
Also, Claude doesn't know which templates are library vs custom.

**Replace the `templateList` construction** inside the `match` function:

```typescript
const templateList = templates
  .map((t) => {
    const summary =
      t.ai_summary ??
      (t.documentation
        ? t.documentation.slice(0, 300).replace(/\s+/g, " ").trim() + "…"
        : null) ??
      "(no summary)";
    return [
      `ID: ${t.id}`,
      `Name: ${t.name}`,
      `Category: ${t.device_category}`,
      `Source: ${t.source}`,
      `Summary: ${summary}`,
    ].join("\n");
  })
  .join("\n\n---\n\n");
```

Also update the `SYSTEM_PROMPT` to tell Claude to prefer library templates:

```typescript
const SYSTEM_PROMPT = `You are a senior PLC project manager assigning Function Block templates to field devices.

For each device, select the BEST matching FB template based on the template summaries provided.

Match criteria:
- Does the template's purpose align with this device type?
- Does the template handle the right kind of IO (discrete, analog, mixed)?
- Is the template designed specifically for this device category?

Preference: prefer templates with Source "library" over "custom" when both would work —
library templates have tested LAD code and matched HMI faceplates.

Confidence:
- "exact": Template is clearly the right choice for this device (purpose + IO match well)
- "probable": Template could work with some adaptation by the AI
- "none": No suitable template — use null for template_id

Respond with ONLY valid JSON (no markdown fences, no explanation):
[{"device_id":"...","template_id":"..." or null,"confidence":"exact"|"probable"|"none","reason":"one concise sentence"}]`;
```

---

## Fix 5 — Use correct template fetch hook in forge.tsx

**File:** `src/routes/forge.tsx`

**Problem:** Line ~105 calls `useFbTemplates()` (no `is_enabled` filter, no profile
scoping). The correct hook is `useFbTemplatesForSession(profileId)`.

**Steps:**

1. Find where `profileId` is available in `forge.tsx`. Look for the active session or
   design profile — it will be something like `session?.design_profile_id` or
   `activeProfile?.id`. Use whatever variable holds the current profile ID.

2. `useFbTemplatesForSession` is already exported from `src/hooks/use-fb-templates.ts`.
   Add it to the import if not already imported.

3. Replace:
   ```typescript
   const { data: fbTemplates = [], refetch: refetchFbTemplates } = useFbTemplates();
   ```
   With:
   ```typescript
   const { data: fbTemplates = [], refetch: refetchFbTemplates } = useFbTemplatesForSession(profileId);
   ```
   Where `profileId` is the resolved profile ID, or `undefined` if not available at
   this point (the `is_enabled` filter still applies when `undefined`).

4. Do NOT remove the `useFbTemplates` import if it is used elsewhere in the file.
   Check before removing.

---

## Verification

After all changes:

1. `npm run typecheck` passes with no errors
2. `tokeniseTemplateName("fbMotor_Reversing")` → `["motor", "reversing"]`
3. `tokeniseTemplateName("fbVFD_GSeries")` → `["vfd", "gseries"]`
4. `nameAffinity("Motor DOL", { name: "fbMotor_Reversing", device_category: "Motor", ... })`
   returns > 0.3
5. `nameAffinity("Motor VFD", { name: "fbVFD_GSeries", device_category: "Motor", ... })`
   returns > 0.3
6. `scoreTemplate()` return object includes `sScore` field
7. A library template scores at least 0.08 higher than an identical custom template
8. `summaryAffinity()` does not throw when both `ai_summary` and `documentation` are null
