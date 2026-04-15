# HMI Builder — Unified Pivot Plan

**Monday tracker**: FEAT-31 (supersedes FEAT-30)
**Status**: Phase 2 in progress
**Created**: 2026-04-11
**Target**: TIA Portal V20 + WinCC Unified + HMI Template Suite V6.0 + Open Library V19

---

## Decision summary (Q1–Q5 answered)

| # | Decision | Choice |
|---|---|---|
| 1 | Panel family strategy | **(a) Pivot HMI module to Unified-only.** Comfort stack is deprecated for new work. IMP-04 guardrail warns users on V18 projects. |
| 2 | Panel scope | **Unified Comfort Panel (MTP700–MTP2200) + PC Station Runtime.** Skip Basic Panels and View of Things for now. |
| 3 | Wizard strategy | **(b) Invoke the Template Suite Wizard via TIA Add-In Openness API.** Later migrate to (c) — direct master-copy replication in the bridge. |
| 3b | Post-wizard data flow | **Static structure from V6.0 manual.** Pac-Forge assumes the standard Template Suite baseline; no post-wizard project inspection. If engineers customise, they diverge from the standard. |
| 4 | Faceplate mode | **(b) Author new faceplate types.** When no library match exists, Pac-Forge AI-generates new faceplates styled to match Template Suite + Open Library conventions. |
| 5 | Theme selection | **Per-project choice.** SiemensLight / SiemensDark / DeepBlue, stored on `HmiPanelConfig`. |

---

## Complementary library model

### HMI Template Suite V6.0 = application shell
- Pre-configured WinCC Unified Operator Panels (Basic + Comfort families, 5 resolutions)
- View of Things (VoT) variants — CPU-hosted HMI (out of scope)
- **4-level navigation system**: MainNavigation → SubNavigation → Third-Level → Tab Navigation
- Layout zones: Title Bar, Status Bar, MainWindow, Option Panel
- **3 color palettes**: SiemensLight, SiemensDark, DeepBlue
- 8-pixel grid design framework
- Screen templates: Dashboard (with Tables), Machine Modules, Mixed Examples, Wizard, Option Panel, Notifications, Function Panel
- Base UI components: Buttons and Icons, Texts and IO Fields, Further Objects
- Built-in Alarm display, Settings/Diagnostics pages
- Multi-language support

### Open Library V19 Unified = device/process faceplates
- Device faceplates (motor, valve, pump, conveyor, analog input, etc.)
- Matching PLC function blocks on the controller side
- Alarm generation patterns
- PID configuration
- SiVArc (Siemens Visualization Architect) integration
- Device simulation helpers

### Pac-Forge role
Pac-Forge sits on top of both libraries and:
1. Generates Unified projects starting from a Template Suite panel baseline
2. Places Open Library faceplates into the MainWindow zone of each screen
3. Wires faceplate tag interfaces to PLC tag mappings
4. **Authors new faceplate types** styled to match the libraries when no existing match is found
5. Generates custom screens (dashboards, alarm summaries, trends) that respect Template Suite layout rules

### Known conflicts to resolve
1. **Styling mismatch** — Open Library faceplates have their own visual style; Template Suite has 3 defined palettes. Mixing naively breaks visual consistency.
2. **Types folder collision** — both libraries use the `Types` folder. Need namespace/naming conflict resolution.
3. **VoT vs standard targeting** — Template Suite explicitly supports VoT; Open Library may or may not. Must verify during Phase 1 inspection.
4. **Tag interface adaptation** — Template Suite screens and Open Library faceplates have different tag conventions. Pac-Forge generates the glue layer.

---

## Phase 1 — Setup and inspection

**Goal**: get hands on both libraries in TIA V20, document what's actually inside, distribute reference docs to the HMI generation agent.

| # | Task | Owner |
|---|---|---|
| 1.1 | Extract Template Suite V6.0 + Open Library PDFs into `Docs/HMI Reference/` | Pac-Forge |
| 1.2 | Import `HMI Template Suite Light (WinCC Unified)_V20.al20` into TIA V20 as global library, document faceplates | User |
| 1.3 | Import `HMI Template Suite Dark (WinCC Unified)_V20.al20` into TIA V20 as global library, document faceplates | User |
| 1.4 | Import `Open Library V19 Unified.zal19` into TIA V20 (migrate V19→V20), document faceplates | User |
| 1.5 | Import `Open Library V19 PLC.zal19` and feed into Pac-Forge FB Library via `/fb-library` | User + Pac-Forge |
| 1.6 | Import `.cd20` Corporate Design file into a test Unified project, verify theme applies | User |
| 1.7 | Upload Template Suite + Open Library reference PDFs to `/reference-library` for HMI agent knowledge | User |
| 1.8 | Download missing `SIMATIC HMI Template Suite Wizard V4.0.0.13 Setup.zip` from Siemens article 91174767 | User |

---

## Phase 2 — Data model (start here)

**Goal**: extend Pac-Forge's type system to represent Unified panels with Template Suite theming.

| # | Task | Target |
|---|---|---|
| 2.1 | Extend `src/types/hmi-panel.ts` with Comfort Panel MTP models and PC Station models | `HMI_UNIFIED_PANELS` |
| 2.2 | Populate `HMI_UNIFIED_PANELS` with 6 panels × native resolutions (800×480 → 1920×1080) | `hmi-panel.ts` |
| 2.3 | Add `hmi_theme` field to `HmiPanelConfig` — `"SiemensLight" \| "SiemensDark" \| "DeepBlue"` | `hmi-panel.ts` |
| 2.4 | Add theme selector to `forge-hmi-configurator.tsx` with per-project persistence | `forge-hmi-configurator.tsx` |

---

## Phase 3 — Template Suite shell + Open Library consumption

**Goal**: teach Pac-Forge to generate Unified content that sits inside the Template Suite's layout and consumes Open Library faceplates.

| # | Task | Target |
|---|---|---|
| 3.1 | Create `src/lib/hmi-unified-structure.ts` — static Template Suite layout from V6.0 manual | new file |
| 3.2 | Create `src/lib/hmi-xml-builder-unified.ts` — SimaticML Unified XML format | new file |
| 3.3 | Extend `hmi-faceplate-catalog.ts` to merge Template Suite chrome widgets + Open Library device faceplates with Types folder conflict resolution | existing file |
| 3.4 | Build tag-mapping layer between Pac-Forge device interfaces and Open Library faceplate interfaces | new file |
| 3.5 | Rewrite `hmi-screen-generators.ts` for Unified with 4-level navigation support | existing file |
| 3.6 | Update AI custom screen prompt in `forge-prompts.ts` to know about Template Suite structure and available library faceplates | existing file |

---

## Phase 4 — Bridge integration

**Goal**: bridge endpoints for invoking the Wizard and importing generated Unified content.

| # | Task | Target |
|---|---|---|
| 4.1 | Bridge endpoint: trigger HMI Template Suite Wizard via TIA Add-In Openness API | `TiaPortalService.cs` |
| 4.2 | Bridge endpoint: import Unified SimaticML screens into an existing project | `TiaPortalService.cs` |
| 4.3 | Stub bridge endpoint for direct master-copy replication (Q3 option C, long-term) | `TiaPortalService.cs` |

---

## Phase 5 — DEFERRED INDEFINITELY (2026-04-11)

**Reason**: Excel analysis of the imported libraries showed Open Library V19 Unified already ships 52 device/process faceplates + 22 `udtHMI_*` tag contracts covering all common automation device types (motors, pumps, valves, VFDs, analog/digital IO, PID, totalizers, interlocks, permissives, weighing, hoppers). Practical coverage is ~80–90% of real-world projects, so authoring new faceplate types is only needed for unusual/custom equipment.

**Replaced with**: a simpler "library-first, warn on miss" UX. When Pac-Forge can't find an Open Library match for a device type, the UI shows a warning and requires the engineer to either pick a close match manually or supply their own faceplate. No AI authoring.

**Revisit conditions**: a real customer project hits a device type Open Library doesn't cover and manual faceplate work becomes painful. Reopen as its own Monday task at that point.

### Replaced tasks (was Phase 5, now minimal Phase 5-lite)

| # | Task | Target |
|---|---|---|
| 5-lite.1 | Warning banner when a device type has no Open Library faceplate match | `forge-hmi-configurator.tsx` |
| 5-lite.2 | "Manual faceplate override" field per unmatched device type | `forge-hmi-configurator.tsx` |

---

## Phase 6 — Standards Reviewer + tests

**Goal**: the HMI Standards Reviewer agent knows about Template Suite and Open Library rules.

| # | Task | Target |
|---|---|---|
| 6.1 | Update HMI Standards Reviewer agent knowledge with Template Suite layout rules | agent knowledge docs |
| 6.2 | Update HMI Standards Reviewer agent knowledge with Open Library faceplate rules | agent knowledge docs |
| 6.3 | Integration test: end-to-end Unified project generation with both libraries via bridge | `/tia-console` demo |

---

## What this plan does NOT cover (out of scope for now)

- **Classic Comfort panel support** — frozen. Use Comfort stack for existing V18 projects only. No new Comfort features.
- **Basic Panels** (Unified Basic) — skip; Pac Technologies target is Comfort Panel + PC Runtime
- **View of Things (VoT)** — CPU-hosted HMI is a niche deployment model; revisit later if a customer needs it
- **Siemens SiVArc integration** — Open Library supports it but Pac-Forge does its own HMI generation; evaluate later as an alternative path
- **Multi-language translation generation** — out of scope for this rebuild
- **Engineer customisation of Template Suite baseline** — Pac-Forge assumes standard structure from the V6.0 manual; if engineers diverge, output won't match. Hybrid (dynamic scan) is a Phase 7 follow-up if pain is real.
- **Custom branded themes via Siemens Corporate Designer** — the 3 stock palettes (SiemensLight / SiemensDark / DeepBlue) are shipped in the Template Suite library and are sufficient. Installing Corporate Designer to create a custom Pac Technologies theme is a future Tier 3 nice-to-have.
- **Phase 5 AI faceplate authoring** — deferred indefinitely, replaced with a library-first "warn on miss" UX. Open Library's 52 device faceplates cover the common cases.
