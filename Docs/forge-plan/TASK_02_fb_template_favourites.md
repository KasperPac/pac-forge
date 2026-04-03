# TASK 02: FB Template Favourites System

## Background

The Siemens Open Library has multiple valid FBs per device category. For example,
a "Motor DOL" device could legitimately use any of:
  - fbMotor_Reversing (contactor-driven, most common)
  - fbMotor_Simocode (Simocode Pro V motor management)
  - fbMotor_Softstarter (3RW30/3RW40)
  - fbMotor_Softstarter_3RW44 (3RW44 specific)

The scoring system cannot distinguish between these without knowing the hardware
context (is there a Simocode? A soft starter? Just contactors?). Rather than
trying to resolve this with more scoring complexity, we use a **favourites system**
per design profile: the engineer pins a preferred template for each device type,
and the matcher uses it without scoring.

This is the right model because:
- In practice, the same FBs are reused across projects
- The engineer knows their hardware standard (e.g. "we always use Simocode")
- Favourites are set once per profile, not per session

---

## What "favourites" means

A favourite is a mapping stored in the design profile:
```
device_type_canonical → template_id
```

Examples:
```json
{
  "Motor DOL":    "uuid-of-fbMotor_Reversing",
  "Motor VFD":    "uuid-of-fbVFD_GSeries",
  "Solenoid Valve 2-pos": "uuid-of-fbValve_Solenoid"
}
```

When the forge pipeline matches devices to templates:
1. Check if this device's `device_type` has a favourite in the profile
2. If yes → assign that template directly, confidence = "exact", skip all scoring
3. If no → run existing heuristic scoring as fallback

---

## Storage approach — JSONB column on design_profiles

Store favourites as a JSONB column `fb_favourites` on `design_profiles`.
Schema: `{ [device_type: string]: string }` (device_type → template_id).

**Why JSONB on design_profiles rather than a join table:**
- Favourites are a profile-level config, not a relational entity
- They're always read together with the profile
- Simple to migrate, simple to reset, simple to copy between profiles
- The map is small (< 50 entries in practice)

---

## Files to create / modify

### New files
1. `supabase/migrations/045_profile_fb_favourites.sql` — DB migration
2. `src/components/forge/fb-favourites-editor.tsx` — UI component

### Modified files
3. `src/types/design-profile.ts` — add `fb_favourites` field
4. `src/lib/forge-device-matcher.ts` — use favourites before scoring
5. `src/components/forge/steps/forge-hardware-io.tsx` — show favourite indicator
6. `src/components/profile-detail.tsx` or equivalent profile edit page — embed editor

---

## Step 1 — Database migration

**File:** `supabase/migrations/045_profile_fb_favourites.sql`

```sql
-- Add fb_favourites JSONB column to design_profiles
-- Stores a map of device_type → template_id for preferred FB templates per device type
ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS fb_favourites JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN design_profiles.fb_favourites IS
  'Map of device_type (string) → fb_template_id (uuid string). '
  'When set, the forge pipeline assigns this template directly without scoring.';
```

---

## Step 2 — TypeScript type update

**File:** `src/types/design-profile.ts`

Add `fb_favourites` to the `DesignProfile` interface:

```typescript
export interface DesignProfile {
  // ... existing fields ...

  /**
   * Map of device_type → template_id for preferred FB templates.
   * When set for a device type, the matcher uses this template directly
   * without running heuristic scoring.
   * e.g. { "Motor DOL": "uuid...", "Solenoid Valve 2-pos": "uuid..." }
   */
  fb_favourites: Record<string, string>;
}
```

Also add it to `DesignProfileCreate` (it should be included there since it's a
user-configurable field, not a system field like `id` or `created_at`).

Update any "default profile shim" in `forge.tsx` (around line 254) to include
`fb_favourites: {}` so TypeScript doesn't complain about missing field.

---

## Step 3 — Matcher integration

**File:** `src/lib/forge-device-matcher.ts`

**Modify `matchDevicesToTemplates()`** to accept an optional `favourites` parameter
and short-circuit for favourite matches:

```typescript
export function matchDevicesToTemplates(
  devices: ForgeDeviceEntry[],
  templates: FbTemplate[],
  favourites: Record<string, string> = {},
): DeviceFbMatch[] {
  return devices.map((device): DeviceFbMatch => {
    // --- Favourite check (highest priority — skip scoring entirely) ---
    const favouriteId = favourites[device.device_type];
    if (favouriteId) {
      const template = templates.find(t => t.id === favouriteId) ?? null;
      if (template) {
        return {
          device,
          template,
          confidence: "exact",
          reason: `"${device.device_type}" matched via profile favourite: "${template.name}".`,
        };
      }
      // Favourite ID set but template not found (deleted?) — fall through to scoring
    }

    if (templates.length === 0) {
      return { device, template: null, confidence: "none", reason: "No templates in library." };
    }

    // --- Existing scoring path (unchanged) ---
    const scores: TemplateScore[] = templates.map(t => scoreTemplate(device, t));
    scores.sort((a, b) => b.combined - a.combined);

    const best = scores[0];
    const confidence = confidenceFromScore(best);

    if (confidence === "none") {
      return { device, template: null, confidence: "none", reason: reasonFor(best, device, "none") };
    }

    return {
      device,
      template: best.template,
      confidence,
      reason: reasonFor(best, device, confidence),
    };
  });
}
```

**Also update `rankTemplatesForDevice()`** to accept favourites and put the favourite
first in the ranked list regardless of score:

```typescript
export function rankTemplatesForDevice(
  device: ForgeDeviceEntry,
  templates: FbTemplate[],
  favourites: Record<string, string> = {},
): TemplateScore[] {
  const scored = templates
    .map(t => scoreTemplate(device, t))
    .sort((a, b) => b.combined - a.combined);

  // Move the favourite to the top if one exists
  const favId = favourites[device.device_type];
  if (favId) {
    const favIdx = scored.findIndex(s => s.template.id === favId);
    if (favIdx > 0) {
      const [fav] = scored.splice(favIdx, 1);
      scored.unshift(fav);
    }
  }
  return scored;
}
```

---

## Step 4 — Pass favourites through the forge pipeline

**File:** `src/components/forge/steps/forge-hardware-io.tsx`

The component already receives `profile` as a prop. Wherever `matchDevicesToTemplates()`
is called, pass `profile.fb_favourites ?? {}` as the third argument:

```typescript
// All occurrences — there are ~4 of them. Find every call to matchDevicesToTemplates
// and add the third argument:
const matches = matchDevicesToTemplates(raw, fbTemplates, profile.fb_favourites ?? {});
```

Also pass favourites to `rankTemplatesForDevice` wherever it is called (check
`forge-device-fb-dialog.tsx` and the template dropdown component):

```typescript
const ranked = rankTemplatesForDevice(device, fbTemplates, profile.fb_favourites ?? {});
```

---

## Step 5 — Also pass favourites to the AI matching hook

**File:** `src/hooks/use-forge-ai-device-match.ts`

Update the `match` function signature to accept favourites and exclude
favourite-matched devices from the AI call (no point sending them):

```typescript
const match = useCallback(
  async (
    devices: ForgeDeviceEntry[],
    templates: FbTemplate[],
    favourites: Record<string, string> = {},
  ): Promise<DeviceFbMatch[]> => {

    // Resolve favourites immediately — don't send these to AI
    const favouriteMatches: DeviceFbMatch[] = [];
    const devicesToMatch: ForgeDeviceEntry[] = [];

    for (const device of devices) {
      const favId = favourites[device.device_type];
      if (favId) {
        const template = templates.find(t => t.id === favId) ?? null;
        if (template) {
          favouriteMatches.push({
            device,
            template,
            confidence: "exact",
            reason: `Matched via profile favourite: "${template.name}".`,
          });
          continue;
        }
      }
      devicesToMatch.push(device);
    }

    if (devicesToMatch.length === 0) return favouriteMatches;

    // Run existing AI matching only for non-favourite devices
    // ... rest of existing logic using devicesToMatch instead of devices ...

    return [...favouriteMatches, /* AI results */];
  },
  [],
);
```

Update all call sites in `forge-hardware-io.tsx` to pass favourites:
```typescript
const aiMatches = await aiMatch(devices, fbTemplates, profile.fb_favourites ?? {});
```

---

## Step 6 — Favourites editor UI component

**File:** `src/components/forge/fb-favourites-editor.tsx`

Build a UI component that:
- Lists all known device types (from a fixed list + any types found in templates' `device_category`)
- For each device type, shows a template dropdown (same dropdown used in forge-hardware-io)
- Allows the user to pin/unpin a favourite template
- Saves changes back to the profile via `useUpdateDesignProfile`

**Component props:**
```typescript
interface FbFavouritesEditorProps {
  profile: DesignProfile;
  templates: FbTemplate[];
}
```

**Fixed device type list** to show even if no template exists yet:
```typescript
const KNOWN_DEVICE_TYPES = [
  "Motor DOL",
  "Motor VFD",
  "Motor Soft Starter",
  "Motor Simocode",
  "Solenoid Valve 2-pos",
  "Analog Valve",
  "Hydraulic Valve",
  "Photoelectric Sensor",
  "Proximity Sensor",
  "Push Button Station",
  "E-Stop Circuit",
  "Analog Input",
  "Analog Output",
  "Digital Input",
  "Digital Output",
  "Stack Light",
  "Conveyor",
];
```

**Visual design:**
- Table layout: Device Type | Preferred Template | Action
- Each row: device type label, template dropdown (same `<Select>` as hardware-io),
  a ★ "Pin" / "Unpin" button
- "Pinned" rows visually distinguished (e.g. subtle highlight, star icon filled)
- Show template source badge ("Library" / "Custom") next to template name in dropdown
- Save is immediate on change (no submit button needed — call `updateProfile` on each
  dropdown change)
- "Clear all" button at the bottom

**State:** Local optimistic state for the map, debounced save to Supabase.

---

## Step 7 — Surface the editor in the profile detail page

**File:** `src/routes/profile-detail.tsx` (or wherever the design profile editor lives)

Find the profile edit page. Add a new tab or section called "FB Favourites" that
renders `<FbFavouritesEditor profile={profile} templates={fbTemplates} />`.

The `fbTemplates` data is available via `useFbTemplates()` (all templates, not
session-scoped, since this is a profile config screen not a forge session).

---

## Step 8 — Show favourite indicator in forge Hardware & IO step

**File:** `src/components/forge/steps/forge-hardware-io.tsx`

In the device table, when a device has been matched via a favourite:
- Show a ★ icon or "Favourite" badge next to the template name
- The dropdown still works normally (user can override the favourite for this session)

Check the `match.reason` string — if it contains "profile favourite", show the indicator.
Or add a separate field to `DeviceFbMatch` — actually, the cleanest approach is to check
`profile.fb_favourites[device.device_type] === device.fb_template_id`.

---

## Verification

1. `npm run typecheck` passes
2. Adding a favourite for "Motor DOL" in the profile editor saves to Supabase
3. Opening a forge session with a spec containing motor devices — motor devices are
   matched to the favourite template without scoring, confidence = "exact"
4. Overriding a favourite in the Hardware & IO dropdown works normally
5. A device type with no favourite set still goes through heuristic scoring
6. A favourite pointing to a deleted template gracefully falls back to scoring
   (the "template not found" branch in the matcher)
7. The favourites editor shows all KNOWN_DEVICE_TYPES even if no template is pinned
8. "Clear all" resets `fb_favourites` to `{}` in the profile

---

## Implementation order

Do these steps in order — each step depends on the previous:
1. Migration (045)
2. Type update
3. Matcher integration
4. Pass through forge pipeline
5. AI hook update
6. Editor UI
7. Profile page integration
8. Forge UI indicator
