import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Electric motor — circle with M and shaft */
function MotorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="18" cy="20" r="13" stroke="currentColor" strokeWidth="2" />
      <text x="18" y="25" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="bold" fontFamily="monospace">M</text>
      {/* Shaft */}
      <line x1="31" y1="20" x2="38" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Sensor / PE — beam emitter and receiver with dashed beam */
function SensorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Emitter body */}
      <rect x="2" y="12" width="10" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Emitter lens */}
      <circle cx="12" cy="20" r="2.5" fill="currentColor" opacity="0.6" />
      {/* Beam (dashed) */}
      <line x1="14" y1="20" x2="26" y2="20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
      {/* Receiver body */}
      <rect x="28" y="12" width="10" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Receiver lens */}
      <circle cx="28" cy="20" r="2.5" fill="currentColor" opacity="0.6" />
      {/* Detection indicator */}
      <circle cx="33" cy="14" r="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

/** Valve — bowtie symbol */
function ValveIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Left triangle */}
      <polygon points="4,10 20,20 4,30" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      {/* Right triangle */}
      <polygon points="36,10 20,20 36,30" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      {/* Stem */}
      <line x1="20" y1="20" x2="20" y2="6" stroke="currentColor" strokeWidth="2" />
      {/* Handwheel */}
      <line x1="14" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Pushbutton — round button with contact symbol */
function PushbuttonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Button housing */}
      <rect x="8" y="4" width="24" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Button cap (raised) */}
      <rect x="14" y="6" width="12" height="6" rx="2" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="1" />
      {/* Contact stem */}
      <line x1="20" y1="18" x2="20" y2="26" stroke="currentColor" strokeWidth="1.5" />
      {/* Contact (NO) */}
      <line x1="12" y1="30" x2="20" y2="26" stroke="currentColor" strokeWidth="1.5" />
      <line x1="20" y1="30" x2="28" y2="30" stroke="currentColor" strokeWidth="1.5" />
      {/* Terminals */}
      <circle cx="12" cy="30" r="1.5" fill="currentColor" />
      <circle cx="28" cy="30" r="1.5" fill="currentColor" />
      <line x1="12" y1="31.5" x2="12" y2="36" stroke="currentColor" strokeWidth="1.5" />
      <line x1="28" y1="31.5" x2="28" y2="36" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Light tower / stack light — 3 stacked lights */
function LightTowerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Base */}
      <rect x="12" y="34" width="16" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      {/* Pole */}
      <rect x="18" y="30" width="4" height="4" fill="currentColor" fillOpacity="0.3" />
      {/* Red light */}
      <rect x="12" y="2" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.12" />
      <circle cx="20" cy="6.5" r="2" fill="currentColor" opacity="0.5" />
      {/* Amber light */}
      <rect x="12" y="11" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
      <circle cx="20" cy="15.5" r="2" fill="currentColor" opacity="0.35" />
      {/* Green light */}
      <rect x="12" y="20" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.05" />
      <circle cx="20" cy="24.5" r="2" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

/** VFD / Variable Frequency Drive — rectangular drive with ~ symbol */
function VfdIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Drive body */}
      <rect x="6" y="4" width="28" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Display area */}
      <rect x="10" y="8" width="20" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
      {/* ~ sine wave */}
      <path d="M13 13 Q16 8, 20 13 Q24 18, 27 13" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Status LED */}
      <circle cx="14" cy="23" r="1.5" fill="currentColor" opacity="0.4" />
      {/* Terminal connections bottom */}
      <line x1="13" y1="36" x2="13" y2="39" stroke="currentColor" strokeWidth="1.5" />
      <line x1="20" y1="36" x2="20" y2="39" stroke="currentColor" strokeWidth="1.5" />
      <line x1="27" y1="36" x2="27" y2="39" stroke="currentColor" strokeWidth="1.5" />
      {/* Labels */}
      <text x="13" y="32" fill="currentColor" fontSize="5" fontFamily="monospace" opacity="0.5">U V W</text>
    </svg>
  );
}

/** Conveyor section — belt on rollers */
function ConveyorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Left roller */}
      <circle cx="9" cy="24" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="24" r="1.5" fill="currentColor" />
      {/* Right roller */}
      <circle cx="31" cy="24" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="31" cy="24" r="1.5" fill="currentColor" />
      {/* Belt top */}
      <line x1="9" y1="18" x2="31" y2="18" stroke="currentColor" strokeWidth="1.5" />
      {/* Belt bottom */}
      <line x1="9" y1="30" x2="31" y2="30" stroke="currentColor" strokeWidth="1.5" />
      {/* Direction arrow */}
      <path d="M16 14 L22 14 L20 11 M22 14 L20 17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Item on belt */}
      <rect x="17" y="12" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

/** ZPA Section — conveyor zone with zones marked */
function ZpaIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Left roller */}
      <circle cx="6" cy="22" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="22" r="1" fill="currentColor" />
      {/* Right roller */}
      <circle cx="34" cy="22" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="34" cy="22" r="1" fill="currentColor" />
      {/* Belt */}
      <line x1="6" y1="18" x2="34" y2="18" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6" y1="26" x2="34" y2="26" stroke="currentColor" strokeWidth="1.5" />
      {/* Zone dividers */}
      <line x1="16" y1="16" x2="16" y2="28" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" opacity="0.5" />
      <line x1="24" y1="16" x2="24" y2="28" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" opacity="0.5" />
      {/* Zone labels */}
      <text x="10" y="14" textAnchor="middle" fill="currentColor" fontSize="5" fontFamily="monospace" opacity="0.6">Z1</text>
      <text x="20" y="14" textAnchor="middle" fill="currentColor" fontSize="5" fontFamily="monospace" opacity="0.6">Z2</text>
      <text x="30" y="14" textAnchor="middle" fill="currentColor" fontSize="5" fontFamily="monospace" opacity="0.6">Z3</text>
      {/* Sensor dots */}
      <circle cx="10" cy="18" r="1.2" fill="currentColor" opacity="0.5" />
      <circle cx="20" cy="18" r="1.2" fill="currentColor" opacity="0.5" />
      <circle cx="30" cy="18" r="1.2" fill="currentColor" opacity="0.5" />
      {/* ZPA label */}
      <text x="20" y="34" textAnchor="middle" fill="currentColor" fontSize="6" fontFamily="monospace" fontWeight="bold" opacity="0.5">ZPA</text>
    </svg>
  );
}

/** Custom / generic — gear/cog symbol */
function CustomIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Gear teeth (8 teeth) */}
      <path
        d="M20 4 L22 8 L26 6 L26 10 L30 10 L28 14 L32 16 L28 18 L30 22 L26 22 L26 26 L22 24 L20 28 L18 24 L14 26 L14 22 L10 22 L12 18 L8 16 L12 14 L10 10 L14 10 L14 6 L18 8 Z"
        stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" strokeLinejoin="round"
      />
      {/* Center hole */}
      <circle cx="20" cy="16" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="20" cy="16" r="1.5" fill="currentColor" opacity="0.4" />
      {/* "?" for custom */}
      <text x="20" y="37" textAnchor="middle" fill="currentColor" fontSize="8" fontFamily="monospace" opacity="0.5">?</text>
    </svg>
  );
}

/** Solenoid — coil with plunger */
function SolenoidIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Coil body */}
      <rect x="8" y="10" width="18" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Coil windings */}
      <path d="M11 14 Q17 12, 23 14" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M11 18 Q17 16, 23 18" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M11 22 Q17 20, 23 22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M11 26 Q17 24, 23 26" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {/* Plunger */}
      <rect x="26" y="17" width="10" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.2" />
      {/* Plunger arrow */}
      <path d="M30 15 L33 17 M30 25 L33 23" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      {/* Terminal wires */}
      <line x1="14" y1="30" x2="14" y2="36" stroke="currentColor" strokeWidth="1.5" />
      <line x1="22" y1="30" x2="22" y2="36" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="36" r="1.5" fill="currentColor" opacity="0.4" />
      <circle cx="22" cy="36" r="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

/** Heater — resistor/heating element symbol */
function HeaterIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Housing */}
      <rect x="8" y="6" width="24" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Heating element zigzag */}
      <path d="M14 12 L18 16 L14 20 L18 24 L14 28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 12 L26 16 L22 20 L26 24 L22 28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Heat waves */}
      <path d="M30 10 Q32 12, 30 14" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M33 8 Q35 11, 33 14" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <path d="M30 22 Q32 24, 30 26" stroke="currentColor" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

/** Analog IO — signal with arrow and wave */
function AnalogIoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Module body */}
      <rect x="6" y="4" width="28" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Analog wave */}
      <path d="M11 20 Q15 10, 20 20 Q25 30, 29 20" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Terminal dots */}
      <circle cx="12" cy="10" r="1.5" fill="currentColor" opacity="0.5" />
      <circle cx="18" cy="10" r="1.5" fill="currentColor" opacity="0.5" />
      <circle cx="24" cy="10" r="1.5" fill="currentColor" opacity="0.5" />
      <circle cx="30" cy="10" r="1.5" fill="currentColor" opacity="0.5" />
      {/* AI label */}
      <text x="20" y="33" textAnchor="middle" fill="currentColor" fontSize="6" fontFamily="monospace" fontWeight="bold" opacity="0.5">AI</text>
    </svg>
  );
}

/** Digital IO — module with on/off indicators */
function DigitalIoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Module body */}
      <rect x="6" y="4" width="28" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* LED indicators */}
      <circle cx="14" cy="12" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="22" cy="12" r="2" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <circle cx="30" cy="12" r="2" fill="currentColor" opacity="0.6" />
      {/* Binary label */}
      <text x="20" y="24" textAnchor="middle" fill="currentColor" fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.4">1 0 1</text>
      {/* DI label */}
      <text x="20" y="33" textAnchor="middle" fill="currentColor" fontSize="6" fontFamily="monospace" fontWeight="bold" opacity="0.5">DI</text>
    </svg>
  );
}

/** Generic IO — module with terminals */
function IoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Module body */}
      <rect x="6" y="4" width="28" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Input arrow */}
      <path d="M2 15 L10 15 L10 12 L16 17 L10 22 L10 19 L2 19" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1" />
      {/* Output arrow */}
      <path d="M38 21 L30 21 L30 18 L24 23 L30 28 L30 25 L38 25" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1" />
      {/* IO label */}
      <text x="20" y="14" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="monospace" fontWeight="bold" opacity="0.5">IO</text>
    </svg>
  );
}

/** Process Control — PID controller symbol */
function ProcessControlIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Controller box */}
      <rect x="6" y="6" width="28" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Setpoint line */}
      <line x1="10" y1="16" x2="34" y2="16" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
      {/* PV response curve */}
      <path d="M10 28 Q14 28, 16 22 Q18 14, 22 16 Q26 18, 28 16 Q30 15, 34 16" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* PID label */}
      <text x="20" y="12" textAnchor="middle" fill="currentColor" fontSize="6" fontFamily="monospace" fontWeight="bold" opacity="0.5">PID</text>
    </svg>
  );
}

/** Safety / Interlock — shield with checkmark */
function SafetyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Shield outline */}
      <path d="M20 3 L34 10 L34 22 Q34 32, 20 37 Q6 32, 6 22 L6 10 Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
      {/* Checkmark */}
      <path d="M14 20 L18 24 L26 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** System / Mode — gear with play/stop */
function SystemIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Outer gear */}
      <path
        d="M20 4 L22 8 L26 6 L26 10 L30 10 L28 14 L32 16 L28 18 L30 22 L26 22 L26 26 L22 24 L20 28 L18 24 L14 26 L14 22 L10 22 L12 18 L8 16 L12 14 L10 10 L14 10 L14 6 L18 8 Z"
        stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" strokeLinejoin="round"
      />
      {/* Center circle */}
      <circle cx="20" cy="16" r="5" stroke="currentColor" strokeWidth="1.5" />
      {/* Play triangle */}
      <polygon points="18,13 18,19 23,16" fill="currentColor" opacity="0.5" />
      {/* Mode label */}
      <text x="20" y="37" textAnchor="middle" fill="currentColor" fontSize="6" fontFamily="monospace" fontWeight="bold" opacity="0.5">SYS</text>
    </svg>
  );
}

/** Instrument — gauge/meter symbol */
function InstrumentIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Gauge circle */}
      <circle cx="20" cy="18" r="14" stroke="currentColor" strokeWidth="1.5" />
      {/* Scale arc */}
      <path d="M10 24 A14 14 0 0 1 30 24" stroke="currentColor" strokeWidth="1" opacity="0.3" fill="none" />
      {/* Needle */}
      <line x1="20" y1="18" x2="28" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Center dot */}
      <circle cx="20" cy="18" r="2" fill="currentColor" opacity="0.5" />
      {/* Scale marks */}
      <line x1="10" y1="18" x2="12" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="20" y1="6" x2="20" y2="8" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="30" y1="18" x2="28" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      {/* Connection */}
      <line x1="20" y1="32" x2="20" y2="38" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Servo — motor with encoder */
function ServoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Motor body */}
      <circle cx="16" cy="20" r="12" stroke="currentColor" strokeWidth="1.5" />
      <text x="16" y="24" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="bold" fontFamily="monospace" opacity="0.6">S</text>
      {/* Shaft */}
      <line x1="28" y1="20" x2="34" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Encoder lines on motor */}
      <line x1="16" y1="8" x2="16" y2="11" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="8" y1="14" x2="10" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="22" y1="14" x2="24" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {/* Feedback arrow */}
      <path d="M34 14 Q38 14, 38 18 L38 22 Q38 26, 34 26" stroke="currentColor" strokeWidth="1" opacity="0.4" fill="none" />
      <path d="M36 25 L34 26 L36 27" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

/** Analyzer — flask/probe symbol */
function AnalyzerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Probe housing */}
      <rect x="16" y="2" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Probe shaft */}
      <rect x="18" y="8" width="4" height="18" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
      {/* Sensing tip */}
      <path d="M18 26 L16 30 L24 30 L22 26" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.2" />
      {/* Signal waves */}
      <path d="M10 14 Q12 12, 14 14 Q16 16, 18 14" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M22 14 Q24 12, 26 14 Q28 16, 30 14" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {/* Display reading */}
      <rect x="10" y="33" width="20" height="5" rx="1" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <text x="20" y="37" textAnchor="middle" fill="currentColor" fontSize="4" fontFamily="monospace" opacity="0.4">7.02</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Category → Icon mapping
// ---------------------------------------------------------------------------

const CATEGORY_ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
  Motor: MotorIcon,
  Sensor: SensorIcon,
  Valve: ValveIcon,
  Pushbutton: PushbuttonIcon,
  LightTower: LightTowerIcon,
  VFD: VfdIcon,
  ConveyorSection: ConveyorIcon,
  ZPASection: ZpaIcon,
  Custom: CustomIcon,
  Solenoid: SolenoidIcon,
  Heater: HeaterIcon,
  Analyzer: AnalyzerIcon,
  AnalogIO: AnalogIoIcon,
  DigitalIO: DigitalIoIcon,
  IO: IoIcon,
  ProcessControl: ProcessControlIcon,
  Safety: SafetyIcon,
  System: SystemIcon,
  Instrument: InstrumentIcon,
  Servo: ServoIcon,
  Conveyor: ConveyorIcon,
};

/**
 * Normalize a category name to a map key.
 * Handles: lowercase, underscores, plural, spaces, hyphens.
 * e.g. "motor" → "Motor", "Motors" → "Motor", "analog_io" → "AnalogIO",
 * "VFD / Drive" → "VFD", "process_control" → "ProcessControl"
 */
const ALIAS_MAP: Record<string, string> = {
  motor: "Motor",
  motors: "Motor",
  sensor: "Sensor",
  sensors: "Sensor",
  valve: "Valve",
  valves: "Valve",
  pushbutton: "Pushbutton",
  pushbuttons: "Pushbutton",
  lighttower: "LightTower",
  vfd: "VFD",
  vfds: "VFD",
  drive: "VFD",
  drives: "VFD",
  conveyorsection: "ConveyorSection",
  conveyor: "Conveyor",
  conveyors: "Conveyor",
  zpasection: "ZPASection",
  zpa: "ZPASection",
  custom: "Custom",
  solenoid: "Solenoid",
  solenoids: "Solenoid",
  heater: "Heater",
  heaters: "Heater",
  analyzer: "Analyzer",
  analyzers: "Analyzer",
  analogio: "AnalogIO",
  analog_io: "AnalogIO",
  digitalio: "DigitalIO",
  digital_io: "DigitalIO",
  io: "IO",
  processcontrol: "ProcessControl",
  process_control: "ProcessControl",
  safety: "Safety",
  interlock: "Safety",
  system: "System",
  instrument: "Instrument",
  instruments: "Instrument",
  servo: "Servo",
  servos: "Servo",
};

function resolveIconKey(categoryName: string): string {
  // Try direct match first
  if (CATEGORY_ICON_MAP[categoryName]) return categoryName;

  // Normalize: lowercase, strip spaces/hyphens/underscores for alias lookup
  const normalized = categoryName.toLowerCase().replace(/[\s\-/]+/g, "").replace(/_/g, "_");

  // Try alias (with underscores preserved for analog_io etc.)
  const aliasKey = ALIAS_MAP[normalized] ?? ALIAS_MAP[categoryName.toLowerCase().replace(/[\s\-/]+/g, "")];
  if (aliasKey) return aliasKey;

  // Try underscore variant
  const underscoreKey = ALIAS_MAP[categoryName.toLowerCase()];
  if (underscoreKey) return underscoreKey;

  return "Custom";
}

/**
 * Get the icon component for a device category.
 * Falls back to CustomIcon for unknown categories.
 */
export function getCategoryIcon(categoryName: string): React.ComponentType<IconProps> {
  return CATEGORY_ICON_MAP[resolveIconKey(categoryName)] ?? CustomIcon;
}

/**
 * Render a category icon with standard sizing and colors.
 * Uses currentColor so it inherits text color from parent.
 */
export function CategoryIcon({
  category,
  className = "h-6 w-6 text-muted-foreground",
}: {
  category: string;
  className?: string;
}) {
  const Icon = getCategoryIcon(category);
  return <Icon className={className} />;
}
