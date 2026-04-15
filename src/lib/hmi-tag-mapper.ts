/**
 * HMI tag mapper — resolves Pac-Forge devices to WinCC Unified faceplate tag bindings.
 *
 * Given a device (with its matched Open Library faceplate) this module produces the tag path
 * and field metadata that a Unified faceplate instance binds to. The actual per-field
 * population is done by the paired FB at runtime — Pac-Forge only generates the binding.
 *
 * Architecture:
 *   - Each device instance gets an instance DB (e.g. "InstMotor1" for fbMotor_Reversing)
 *   - The FB exposes a `hmi : udtHMI_MotorControl` static variable
 *   - The faceplate binds to the whole struct via tag path `"InstMotor1".hmi`
 *   - Individual fields are addressed as `"InstMotor1".hmi.bForwardOn` etc.
 */

import type { UdtDefinition, UdtField } from "./open-library-udt-catalog";
import { getUdtDefinition, getFieldsByDirection } from "./open-library-udt-catalog";
import type { OpenLibraryFaceplate } from "./open-library-catalog";
import type { ForgeDeviceEntry } from "@/types/forge";
import type { FaceplateCatalogEntry } from "@/types/hmi-panel";

// ---------------------------------------------------------------------------
// Tag path resolution
// ---------------------------------------------------------------------------

/**
 * Where the udtHMI_* instance lives — affects the generated tag path syntax.
 */
export type UdtContainer =
  /** Default: UDT is a `hmi` static member of an FB's instance DB */
  | { kind: "instance_db"; instanceDbName: string; memberName?: string }
  /** UDT is the top-level type of a global DB (no FB wrapping) */
  | { kind: "global_db"; globalDbName: string };

/**
 * Generate a WinCC Unified tag path for a single UDT field.
 * Handles both instance-DB wrapping and global-DB containers.
 *
 * Examples:
 *   instance_db: `"InstMotor1".hmi.bForwardOn`
 *   global_db:   `"DB_MotorHmi".bForwardOn`
 */
export function resolveHmiTagPath(container: UdtContainer, fieldName: string): string {
  if (container.kind === "instance_db") {
    const member = container.memberName ?? "hmi";
    return `"${container.instanceDbName}".${member}.${fieldName}`;
  }
  return `"${container.globalDbName}".${fieldName}`;
}

/**
 * Return the struct-level tag path (the whole UDT instance) that a faceplate binds to
 * when using the "single struct binding" pattern common in Open Library faceplates.
 */
export function resolveHmiStructTagPath(container: UdtContainer): string {
  if (container.kind === "instance_db") {
    const member = container.memberName ?? "hmi";
    return `"${container.instanceDbName}".${member}`;
  }
  return `"${container.globalDbName}"`;
}

// ---------------------------------------------------------------------------
// Faceplate tag bindings — one per device instance
// ---------------------------------------------------------------------------

export interface FaceplateFieldBinding {
  /** Field name in the UDT, e.g. "bForwardOn" */
  field: string;
  /** Full tag path to bind, e.g. `"InstMotor1".hmi.bForwardOn` */
  tagPath: string;
  /** SCL data type: Int, Bool, Real, etc. */
  dataType: string;
  /** Direction: true = HMI writes to PLC, false = PLC writes to HMI */
  hmiWritable: boolean;
  /** Human description */
  comment: string;
}

export interface FaceplateTagBinding {
  /** Pac-Forge device instance name, e.g. "Motor1" */
  deviceName: string;
  /** Open Library faceplate type, e.g. "fpMotor_Motor_Horizontal" */
  faceplateType: string;
  /** UDT that defines the tag contract, e.g. "udtHMI_MotorControl" */
  udtName: string;
  /** Tag path to the whole struct (for single-struct-binding faceplates) */
  structTagPath: string;
  /** Per-field bindings (for faceplates that bind individual properties) */
  fields: FaceplateFieldBinding[];
  /** Subset of fields the HMI writes to PLC — commands, buttons, setpoints */
  hmiWritable: FaceplateFieldBinding[];
  /** Subset of fields the PLC writes to HMI — status, feedback, actual values */
  hmiReadOnly: FaceplateFieldBinding[];
}

/**
 * Build a faceplate tag binding for a specific device instance + UDT.
 * Returns null when the UDT is unknown (no catalog entry).
 */
export function buildFaceplateTagBinding(
  deviceName: string,
  faceplateType: string,
  udtName: string,
  container: UdtContainer,
): FaceplateTagBinding | null {
  const udt = getUdtDefinition(udtName);
  if (!udt) return null;

  const fields: FaceplateFieldBinding[] = udt.fields.map((f) => ({
    field: f.name,
    tagPath: resolveHmiTagPath(container, f.name),
    dataType: f.dataType,
    hmiWritable: f.hmiWritable,
    comment: f.comment,
  }));

  return {
    deviceName,
    faceplateType,
    udtName,
    structTagPath: resolveHmiStructTagPath(container),
    fields,
    hmiWritable: fields.filter((f) => f.hmiWritable),
    hmiReadOnly: fields.filter((f) => !f.hmiWritable),
  };
}

// ---------------------------------------------------------------------------
// Device → faceplate binding (catalog-driven convenience)
// ---------------------------------------------------------------------------

/**
 * Given a Pac-Forge device and its faceplate catalog entry, return the tag binding
 * to use when placing this device's faceplate instance on a screen.
 *
 * Uses the default `instance_db` container convention:
 *   instance DB name = "Inst" + pascalCase(device.name)
 *
 * Returns null when the faceplate has no paired UDT in the catalog (e.g. algorithmic
 * entries from the Phase 5-lite fallback path).
 */
export function buildDeviceFaceplateBinding(
  device: ForgeDeviceEntry,
  catalogEntry: FaceplateCatalogEntry,
): FaceplateTagBinding | null {
  const openLibraryFp: OpenLibraryFaceplate | null = catalogEntry.openLibraryFaceplate;
  if (!openLibraryFp || !openLibraryFp.pairedUdtHmi) return null;

  const instanceDbName = `Inst${pascalCase(device.name)}`;
  return buildFaceplateTagBinding(
    device.name,
    openLibraryFp.name,
    openLibraryFp.pairedUdtHmi,
    { kind: "instance_db", instanceDbName },
  );
}

/**
 * Build bindings for every device in a catalog that has a paired Open Library UDT.
 * Devices without a matched UDT are skipped (they need Phase 5-lite manual overrides).
 */
export function buildAllDeviceBindings(
  devices: ForgeDeviceEntry[],
  catalog: FaceplateCatalogEntry[],
): FaceplateTagBinding[] {
  const catalogByDeviceType = new Map(catalog.map((c) => [c.deviceType, c]));
  const bindings: FaceplateTagBinding[] = [];

  for (const device of devices) {
    const entry = catalogByDeviceType.get(device.device_type);
    if (!entry) continue;
    const binding = buildDeviceFaceplateBinding(device, entry);
    if (binding) bindings.push(binding);
  }

  return bindings;
}

// ---------------------------------------------------------------------------
// Coverage helpers — answer "which devices have UDT coverage?"
// ---------------------------------------------------------------------------

export interface DeviceCoverageReport {
  totalDevices: number;
  withLibraryFaceplate: number;
  withUdtBinding: number;
  unmatched: Array<{ deviceType: string; deviceName: string }>;
}

/**
 * Summarize how many devices in a forge session have Open Library faceplate + UDT coverage.
 * The `unmatched` list is what Phase 5-lite warns about.
 */
export function computeDeviceCoverage(
  devices: ForgeDeviceEntry[],
  catalog: FaceplateCatalogEntry[],
): DeviceCoverageReport {
  const catalogByDeviceType = new Map(catalog.map((c) => [c.deviceType, c]));
  let withLibrary = 0;
  let withUdt = 0;
  const unmatched: Array<{ deviceType: string; deviceName: string }> = [];

  for (const device of devices) {
    const entry = catalogByDeviceType.get(device.device_type);
    if (entry?.source === "open-library") {
      withLibrary++;
      if (entry.openLibraryFaceplate?.pairedUdtHmi) {
        withUdt++;
      }
    } else {
      unmatched.push({ deviceType: device.device_type, deviceName: device.name });
    }
  }

  return {
    totalDevices: devices.length,
    withLibraryFaceplate: withLibrary,
    withUdtBinding: withUdt,
    unmatched,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pascalCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/**
 * Re-export a few convenience functions from the UDT catalog so callers don't need
 * to know which module exposes them.
 */
export { getUdtDefinition, getFieldsByDirection };
export type { UdtDefinition, UdtField };
