# PacForge Bridge Changelog

Every bridge change bumps `BridgeVersion` in `TiaPortalService.cs` (semver:
new capability = minor, fix = patch) and gets an entry here. The running
version is visible at `GET /tia/status`.

## 1.3.0 — 2026-07-22

Alarm-class creation (G8-2, consumed by the app's generated HMI build):

- `POST /tia/hmi/build` gains an `alarmClasses[]` section, processed before
  `alarms[]`: `{ "name": "Fault", "acknowledgement": true }` finds-or-creates
  the class and sets its state machine (`RaiseClearRequiresAcknowledgement`
  when acknowledgement is true, `RaiseClear` otherwise). Previously the alarms
  section could only *assign* classes that already existed in the panel, so
  generated Fault/Warning classes had to be created by hand. API shapes
  verified against the V20 Openness catalogue.

## 1.2.0 — 2026-07-08

WinCC Unified authoring extensions (Segment Wagon commissioning — maintenance
screen encoder-reset polish):

- `POST /tia/hmi/build` `tags[]`: new `"internal": true` flag creates an
  HMI-local internal tag (no PLC connection) with the given `dataType` and
  optional `initial` value — for UI scratch state (e.g. a two-tap "armed"
  flag). Without it every tag was forced onto the PLC connection.
- `POST /tia/hmi/build` `editItems[].set`: `Text` / `AlternateText` / `Content`
  (MultilingualText properties) are now routed through the XHTML text helper,
  so an existing item's caption can be relabelled. Previously `set` only
  handled scalar/Color attributes and silently failed on text.

WinCC Unified HMI inspection + authoring extensions (Segment Wagon commissioning):

- `GET /tia/hmi/inspect`: now dumps per-tag detail (`name`, `connection`,
  `plcTag`, `dataType`) — diagnoses broken tag bindings / orphan connections.
- `GET /tia/hmi/screen?name=X&props=1`: full recursive property-graph dump of
  every screen item, including dynamization internals
  (`ValueConverter.MappingTable` etc.) — the discovery tool for element options.
- `POST /tia/hmi/build` item specs:
  - `IOField` now binds values via a **Tag dynamization on `ProcessValue`**
    (static `ProcessValue` rendered the tag name — root cause of "names not
    values" on the panel).
  - `Circle` supports `alternateBackColor` (lamp on-colour).
  - Dynamization specs support `singleBit: {off, on}` — configures
    `ValueConverter.MappingTable` with `ConditionType=Singlebit` + the two
    bitmask rows (the editor's "Single bit" selection; without it a Bool→color
    dynamization never changes the colour).
- `editItems` gains: `dynamizations` (create-or-update, idempotent by property
  name), `removeDynamizations` (delete by property name), Color-string
  coercion and Int64→CLR-type coercion in `set` (Openness setters are strictly
  typed).
- `ApplyDynamizations` factored out and shared by item creation and editItems.

## 1.0.0 — baseline

HTTP/WS bridge as of the HRE commissioning start: status, import/reimport +
compile, export sources/block XML, LAD import, project create, Pac-Audit
extraction, WinCC Unified HMI build (tags/screens/items/alarms/events),
HMI export/inspect/compile, migration helpers.
