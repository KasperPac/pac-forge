/**
 * Open Library V19 Unified — faceplate and function-block catalog.
 *
 * Hard-coded inventory derived from the Excel export of the imported library
 * (Docs/HMI Reference/OpenLibrary_V19_Unified_Inventory.txt).
 *
 * Pac-Forge uses this to resolve a device type (e.g. "Motor DOL") to the
 * best-matching Open Library faceplate (`fpMotor_Motor_Horizontal`), its paired
 * PLC function block (`fbMotor_*`), and the HMI tag contract UDT (`udtHMI_MotorControl`).
 *
 * When no match exists, callers should fall back to algorithmic naming (from
 * hmi-faceplate-catalog.ts) and surface a Phase 5-lite warning.
 */

export interface OpenLibraryFaceplate {
  /** Library-defined faceplate type name, e.g. "fpMotor_Motor_Horizontal". */
  name: string;
  /** Which category this faceplate lives in — drives how Pac-Forge places it. */
  category: "device-icon" | "device-popup" | "process-icon" | "process-popup";
  /** Orientation variant, if the faceplate has one. */
  orientation: "horizontal" | "vertical" | "none";
  /** Paired PLC function block name, if applicable. */
  pairedFb: string | null;
  /** Paired HMI↔PLC tag contract UDT name. Phase 3.4 uses this to drive tag mapping. */
  pairedUdtHmi: string | null;
  /** Lowercased keyword list for device-type matching. */
  keywords: string[];
  /** Companion popup faceplate name, if one exists. */
  companionPopup: string | null;
}

// ---------------------------------------------------------------------------
// Device icon faceplates — sit inline on overview screens
// ---------------------------------------------------------------------------

const DEVICE_ICON_FACEPLATES: OpenLibraryFaceplate[] = [
  // Motor family
  {
    name: "fpMotor_Motor_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbMotor_Reversing",
    pairedUdtHmi: "udtHMI_MotorControl",
    keywords: ["motor", "dol", "direct online", "induction", "fixed speed"],
    companionPopup: "fpMotorReversing_Popup",
  },
  {
    name: "fpMotor_Motor_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbMotor_Reversing",
    pairedUdtHmi: "udtHMI_MotorControl",
    keywords: ["motor", "dol", "direct online", "induction", "fixed speed"],
    companionPopup: "fpMotorReversing_Popup",
  },
  {
    name: "fpMotor_SoftStarter_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbMotor_SoftStarter",
    pairedUdtHmi: "udtHMI_SoftStarter",
    keywords: ["motor", "soft starter", "softstarter", "reduced voltage"],
    companionPopup: "fpMotor_SoftStarter_Popup",
  },
  {
    name: "fpMotor_SoftStarter_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbMotor_SoftStarter",
    pairedUdtHmi: "udtHMI_SoftStarter",
    keywords: ["motor", "soft starter", "softstarter", "reduced voltage"],
    companionPopup: "fpMotor_SoftStarter_Popup",
  },
  {
    name: "fpMotor_SoftStarter3RW44_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbMotor_SoftStarter_3RW44",
    pairedUdtHmi: "udtHMI_3RW44Control",
    keywords: ["3rw44", "siemens soft starter", "sirius"],
    companionPopup: "fpMotor_SoftStarter_3RW44_Popup",
  },
  {
    name: "fpMotor_SoftStarter3RW44_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbMotor_SoftStarter_3RW44",
    pairedUdtHmi: "udtHMI_3RW44Control",
    keywords: ["3rw44", "siemens soft starter", "sirius"],
    companionPopup: "fpMotor_SoftStarter_3RW44_Popup",
  },

  // Pump family (shares motor blocks + udt)
  {
    name: "fpMotor_Pump_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbMotor_Reversing",
    pairedUdtHmi: "udtHMI_MotorControl",
    keywords: ["pump", "centrifugal pump", "fixed speed pump"],
    companionPopup: "fpMotorReversing_Popup",
  },
  {
    name: "fpMotor_Pump_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbMotor_Reversing",
    pairedUdtHmi: "udtHMI_MotorControl",
    keywords: ["pump", "centrifugal pump", "fixed speed pump"],
    companionPopup: "fpMotorReversing_Popup",
  },
  {
    name: "fpPump_SoftStarter_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbMotor_SoftStarter",
    pairedUdtHmi: "udtHMI_SoftStarter",
    keywords: ["pump", "soft starter pump", "softstarter pump"],
    companionPopup: "fpMotor_SoftStarter_Popup",
  },
  {
    name: "fpPump_SoftStarter_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbMotor_SoftStarter",
    pairedUdtHmi: "udtHMI_SoftStarter",
    keywords: ["pump", "soft starter pump", "softstarter pump"],
    companionPopup: "fpMotor_SoftStarter_Popup",
  },
  {
    name: "fpPump_SoftStarter3RW44_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbMotor_SoftStarter_3RW44",
    pairedUdtHmi: "udtHMI_3RW44Control",
    keywords: ["pump", "3rw44 pump", "siemens soft starter pump"],
    companionPopup: "fpMotor_SoftStarter_3RW44_Popup",
  },
  {
    name: "fpPump_SoftStarter3RW44_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbMotor_SoftStarter_3RW44",
    pairedUdtHmi: "udtHMI_3RW44Control",
    keywords: ["pump", "3rw44 pump", "siemens soft starter pump"],
    companionPopup: "fpMotor_SoftStarter_3RW44_Popup",
  },

  // VFD family
  {
    name: "fpVFD_Motor_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbVFD_GSeries",
    pairedUdtHmi: "udtHMI_VFD_Control",
    keywords: ["vfd", "variable frequency drive", "inverter", "drive", "variable speed motor"],
    companionPopup: "fbVFD_Popup",
  },
  {
    name: "fpVFD_Motor_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbVFD_GSeries",
    pairedUdtHmi: "udtHMI_VFD_Control",
    keywords: ["vfd", "variable frequency drive", "inverter", "drive", "variable speed motor"],
    companionPopup: "fbVFD_Popup",
  },
  {
    name: "fpVFD_Pump_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbVFD_GSeries",
    pairedUdtHmi: "udtHMI_VFD_Control",
    keywords: ["vfd pump", "variable frequency drive pump", "inverter pump", "variable speed pump"],
    companionPopup: "fbVFD_Popup",
  },
  {
    name: "fpVFD_Pump_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbVFD_GSeries",
    pairedUdtHmi: "udtHMI_VFD_Control",
    keywords: ["vfd pump", "variable frequency drive pump", "inverter pump", "variable speed pump"],
    companionPopup: "fbVFD_Popup",
  },

  // Valve family
  {
    name: "fpValve_Solenoid_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbValve_Solenoid",
    pairedUdtHmi: "udtHMI_ValveControl",
    keywords: ["solenoid valve", "on off valve", "2-way valve", "shutoff valve", "isolation valve"],
    companionPopup: "fpValve_Solenoid_Popup",
  },
  {
    name: "fpValve_Solenoid_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbValve_Solenoid",
    pairedUdtHmi: "udtHMI_ValveControl",
    keywords: ["solenoid valve", "on off valve", "2-way valve", "shutoff valve", "isolation valve"],
    companionPopup: "fpValve_Solenoid_Popup",
  },
  {
    name: "fpValve_Analog_Horizontal",
    category: "device-icon",
    orientation: "horizontal",
    pairedFb: "fbValve_Analog",
    pairedUdtHmi: "udtHMI_AnalogValveControl",
    keywords: ["analog valve", "control valve", "modulating valve", "proportional valve", "positioning valve"],
    companionPopup: "fpValve_Analog_Popup",
  },
  {
    name: "fpValve_Analog_Vertical",
    category: "device-icon",
    orientation: "vertical",
    pairedFb: "fbValve_Analog",
    pairedUdtHmi: "udtHMI_AnalogValveControl",
    keywords: ["analog valve", "control valve", "modulating valve", "proportional valve", "positioning valve"],
    companionPopup: "fpValve_Analog_Popup",
  },

  // IO faceplates
  {
    name: "fpAnalogInput_Numeric",
    category: "device-icon",
    orientation: "none",
    pairedFb: "fbIO_AnalogInput",
    pairedUdtHmi: "udtHMI_AnalogInput",
    keywords: ["analog input", "ai", "analog sensor", "transmitter", "temperature sensor", "pressure sensor", "level sensor"],
    companionPopup: "fpAnalogInput_Popup",
  },
  {
    name: "fpAnalogOutput",
    category: "device-icon",
    orientation: "none",
    pairedFb: "fbIO_AnalogOutput",
    pairedUdtHmi: "udtHMI_AnalogOutput",
    keywords: ["analog output", "ao", "4-20ma output", "analog setpoint"],
    companionPopup: "fpAnalogOutput_Popup",
  },
  {
    name: "fpDigitalInput",
    category: "device-icon",
    orientation: "none",
    pairedFb: "fbIO_DigitalInput",
    pairedUdtHmi: "udtHMI_DigitalInput",
    keywords: ["digital input", "di", "switch", "limit switch", "proximity", "discrete input"],
    companionPopup: "fpDigitalInput_Popup",
  },
  {
    name: "fpDigitalOutput",
    category: "device-icon",
    orientation: "none",
    pairedFb: "fbIO_DigitalOutput",
    pairedUdtHmi: "udtHMI_DigitalOutput",
    keywords: ["digital output", "do", "relay output", "indicator", "discrete output"],
    companionPopup: "fpDigitalOutput_Popup",
  },

  // Weighing
  {
    name: "fpSiwareWP321",
    category: "device-icon",
    orientation: "none",
    pairedFb: "fbSiwarexWP321",
    pairedUdtHmi: "udtHMI_SiwarexControl",
    keywords: ["siwarex", "wp321", "load cell", "weighing", "weight scale"],
    companionPopup: "fpSiwarex_Popup",
  },
];

// ---------------------------------------------------------------------------
// Process icon faceplates — non-device process views
// ---------------------------------------------------------------------------

const PROCESS_ICON_FACEPLATES: OpenLibraryFaceplate[] = [
  {
    name: "fpFlowTotalizer",
    category: "process-icon",
    orientation: "none",
    pairedFb: "fbFlowTotalizer",
    pairedUdtHmi: null,
    keywords: ["flow totalizer", "flow meter", "flow accumulator", "totalizer"],
    companionPopup: "fpFlowTotalizer_Popup",
  },
  {
    name: "fpHopperLevel_Numeric",
    category: "process-icon",
    orientation: "none",
    pairedFb: "fbHopperLevel",
    pairedUdtHmi: "udtHMI_HopperControl_Status",
    keywords: ["hopper", "hopper level", "silo level", "bin level"],
    companionPopup: "fpHopperLevel_Popup",
  },
  {
    name: "fpHopperLevel_Bar",
    category: "process-icon",
    orientation: "none",
    pairedFb: "fbHopperLevel",
    pairedUdtHmi: "udtHMI_HopperControl_Status",
    keywords: ["hopper bar", "silo bar", "level bar graph"],
    companionPopup: "fpHopperLevel_Popup",
  },
  {
    name: "fpInterlock",
    category: "process-icon",
    orientation: "none",
    pairedFb: "fbInterlock",
    pairedUdtHmi: "udtHMI_Interlock",
    keywords: ["interlock", "safety interlock", "trip"],
    companionPopup: "fpInterlock16_Popup",
  },
  {
    name: "fpPermissive",
    category: "process-icon",
    orientation: "none",
    pairedFb: "fbPermissive",
    pairedUdtHmi: "udtHMI_Permissive",
    keywords: ["permissive", "start permissive", "ready to run"],
    companionPopup: "fpPermissive16_Popup",
  },
  {
    name: "fpSystemControl",
    category: "process-icon",
    orientation: "none",
    pairedFb: null,
    pairedUdtHmi: "udtHMI_SystemControl",
    keywords: ["system control", "master control", "system status"],
    companionPopup: "fpSystemControl_Popup",
  },
  {
    name: "fpSystemRunControl",
    category: "process-icon",
    orientation: "none",
    pairedFb: null,
    pairedUdtHmi: "udtHMI_SystemControl",
    keywords: ["system run control", "run stop", "machine run control"],
    companionPopup: "fpSystemRunControl_Popup",
  },
];

// ---------------------------------------------------------------------------
// Combined master catalog
// ---------------------------------------------------------------------------

export const OPEN_LIBRARY_V19_UNIFIED_FACEPLATES: OpenLibraryFaceplate[] = [
  ...DEVICE_ICON_FACEPLATES,
  ...PROCESS_ICON_FACEPLATES,
];

/**
 * The 3 application-level chrome faceplates shipped by the HMI Template Suite.
 * Distinct from device faceplates — rarely used directly by Pac-Forge generation
 * but catalogued for the merger so naming collisions are explicit.
 */
export const TEMPLATE_SUITE_CHROME_TYPES = [
  "Control Modul PopUp",
  "PieChart",
  "ValueStepper",
] as const;

// ---------------------------------------------------------------------------
// Device-type → faceplate matching
// ---------------------------------------------------------------------------

/**
 * Find the best Open Library faceplate match for a given device type string.
 * Returns null when no confident match is found — caller should fall back.
 *
 * Matching rules:
 *   1. Normalize device type (lowercase, strip punctuation)
 *   2. Score each faceplate by counting matched keywords (multi-word keywords
 *      are checked against the full normalized string, single words against tokens)
 *   3. Apply orientation preference (horizontal by default)
 *   4. Return highest-scoring match, or null if no keywords matched
 */
export function findOpenLibraryFaceplate(
  deviceType: string,
  preferOrientation: "horizontal" | "vertical" = "horizontal",
): OpenLibraryFaceplate | null {
  const normalized = deviceType.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = new Set(normalized.split(" ").filter(Boolean));

  let best: { fp: OpenLibraryFaceplate; score: number } | null = null;

  for (const fp of OPEN_LIBRARY_V19_UNIFIED_FACEPLATES) {
    let score = 0;
    for (const kw of fp.keywords) {
      const kwLower = kw.toLowerCase();
      if (kwLower.includes(" ")) {
        // Multi-word keyword — match against the full string
        if (normalized.includes(kwLower)) score += 2;
      } else if (tokens.has(kwLower)) {
        score += 1;
      }
    }

    if (score === 0) continue;

    // Orientation preference tiebreak
    if (fp.orientation === preferOrientation) score += 0.5;
    else if (fp.orientation === "none") score += 0.25;

    if (!best || score > best.score) {
      best = { fp, score };
    }
  }

  return best?.fp ?? null;
}

/**
 * Look up an Open Library faceplate by exact name. Useful when the caller
 * already knows the faceplate name from a design profile or manual override.
 */
export function getOpenLibraryFaceplateByName(
  name: string,
): OpenLibraryFaceplate | null {
  return OPEN_LIBRARY_V19_UNIFIED_FACEPLATES.find((fp) => fp.name === name) ?? null;
}
