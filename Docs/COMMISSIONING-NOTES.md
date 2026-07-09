# Commissioning Notes

General TIA Portal / WinCC Unified rules learned during commissioning. Written
as reusable guidance for HMI generation — not tied to any one project.

---

## HMI values must be bound via *dynamization*, never a static value

**Symptom.** Every field on the panel displays its **tag name** as literal text
instead of the live value.

**Root cause.** The value was bound by setting the field's `ProcessValue` to a
**static string** equal to the tag name. A static `ProcessValue` renders
literally. Binding the tag to the correct connection is necessary but **not
sufficient** — the binding *mechanism* itself must be a dynamization.

**Rules.**
- **IOField values** must be bound with a **Tag dynamization on the
  `ProcessValue` property** (the tag is set *inside* the dynamization). Input
  fields: `readOnly = false`.
- **Toggles / switches** bind via an `IsAlternateState` Tag dynamization
  (writeable).
- **Lamps (bool → colour)**: the Tag dynamization goes on the **base colour
  property** (`BackColor`) bound to the Bool tag — but the dynamization alone
  is only the wiring. The colour switch is the dynamization's
  **`ValueConverter.MappingTable`**: set `ConditionType = Singlebit` and add
  two bitmask rows — `Condition 0 → Value = off colour`, `Condition 1 →
  Value = on colour` (this is the editor's "Single bit" selection). Without
  the mapping table the property never changes. Each row also carries
  `Flashing` / `FlashingRate` / `AlternateValue` for flashing indicators.
  Dynamizing `AlternateBackColor` does nothing.
- **Tags must ride the *partnered* connection** — the one whose partner is the
  PLC — with the PLC tag set. Wizard/template projects often carry an **orphan
  placeholder connection** (no partner, wrong driver, frequently undeletable);
  tags stranded on it never resolve, and they display blank or as their name.

## Screen-window paths in navigation scripts are relative to the script's screen

**Symptom.** `ChangeScreen("X", "swContent")` compiles on the template's own
nav buttons but fails with *"The object HmiScreenWindow with the name
'swContent' was not found"* on buttons added to content screens.

**Root cause.** The screen-window path resolves relative to the screen the
script lives on. The template layout screen *owns* the content window, so the
plain name works there — but a content screen is hosted *inside* that window,
so from its items the name doesn't resolve.

**Rule.** Navigation buttons placed on a hosted content screen must address the
container via the parent: `ChangeScreen("<target>", "../<window-name>")` — up
one level to the layout screen, then the window by name. Also set the event
handler's `GlobalDefinitionAreaScriptCode` to `"//"` when creating fresh
handlers via Openness — the default carries template imports that fail compile.
