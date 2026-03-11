# FILE OWNERSHIP — Merge Conflict Prevention

**Rule:** Only ONE agent should edit a file at a time. If both need to touch the same file, coordinate via the engineer (Kasper).

---

## CLAUDE CODE OWNS (do not edit without coordination)

### New files (Claude Code creates these):
```
supabase/migrations/025_forge_sessions.sql
src/types/forge.ts                          ← SHARED: Claude Code creates, Codex imports
src/hooks/use-forge-session.ts
src/hooks/use-forge-spec-analysis.ts
src/hooks/use-forge-device-generate.ts
src/hooks/use-forge-process-generate.ts
src/hooks/use-forge-hmi-generate.ts
src/hooks/use-forge-tia-export.ts
src/lib/forge-prompts.ts
src/lib/forge-spec-parser.ts
src/lib/forge-device-matcher.ts
src/lib/forge-pipeline.ts
src/lib/forge-export.ts
```

### Existing files Claude Code may modify:
```
src/types/design-profile.ts                 ← Adding new fields
src/hooks/use-design-profiles.ts            ← If query changes needed
src/lib/prompt-builder.ts                   ← If refactoring shared logic
src/lib/process-prompt-builder.ts           ← If refactoring shared logic
Any file in ai/                             ← Platform rules, SCL reference
Any file in supabase/migrations/            ← Schema changes
```

---

## CODEX OWNS (do not edit without coordination)

### New files (Codex creates these):
```
src/routes/forge.tsx
src/stores/forge-store.ts
src/components/forge/forge-step-bar.tsx
src/components/forge/steps/forge-spec-upload.tsx
src/components/forge/steps/forge-project-setup.tsx
src/components/forge/steps/forge-hardware-io.tsx
src/components/forge/steps/forge-device-code.tsx
src/components/forge/steps/forge-process-code.tsx
src/components/forge/steps/forge-hmi.tsx
src/components/forge/steps/forge-tia-export.tsx
```

### Existing files Codex may modify:
```
src/App.tsx                                 ← Adding forge route
src/app/DashboardLayout.tsx                 ← Adding nav item
```

---

## SHARED / COORDINATE FIRST

These files may need edits from both agents. **Always coordinate:**

```
src/types/forge.ts                          ← Claude Code creates structure, Codex imports
src/types/design-profile.ts                 ← Claude Code adds fields, Codex uses in forms
```

---

## DO NOT TOUCH (either agent)

These existing files should NOT be modified during the wizard build:

```
src/routes/pac-st.tsx                       ← Legacy, keep as fallback
src/routes/process-builder.tsx              ← Legacy, keep as fallback
src/routes/fb-builder.tsx                   ← Legacy, keep as fallback
src/routes/tia-console.tsx                  ← Legacy, keep as fallback
src/routes/pac-lad.tsx                      ← Legacy, keep as fallback
src/routes/hmi-editor.tsx                   ← Legacy, keep as fallback
src/components/pac-st/*                     ← Legacy components
src/components/process-builder/*            ← Legacy components
src/components/tia-console/*               ← Legacy components
supabase/functions/generate/index.ts        ← Edge function works, don't touch
bridge/*                                    ← .NET bridge works, don't touch
```

---

## MERGE STRATEGY

If both agents are working simultaneously:
1. Have them work in their own file domains (above)
2. If a conflict does arise, Kasper resolves manually
3. Both agents should `git pull` before starting a new task
4. Commit frequently with descriptive messages
5. Suggested commit prefixes:
   - `forge-ui:` for Codex commits
   - `forge-logic:` for Claude Code commits
   - `forge-types:` for shared type changes
