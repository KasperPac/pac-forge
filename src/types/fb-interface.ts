// src/types/fb-interface.ts
// Structured, self-describing interface contract for an FB Library template.
// Generic across machine types — roles and binding sources are abstract; never
// device-specific. See Docs/superpowers/specs/2026-06-23-fb-library-interface-contract-design.md.

/** Semantic purpose of an FB pin. */
export const FB_PIN_ROLES = [
  "cmd",          // command input (start/stop/forward) — typically HMI or EM
  "mode",         // mode / selection input
  "param",        // configuration parameter input
  "interlock",    // interlock / permissive input
  "sensor_in",    // process feedback input (wired DI/AI or conditioned upstream FB output)
  "actuator_out", // physical actuation output (to the Output image DB)
  "status",       // status output (running / ready / done / position)
  "fault",        // fault / alarm output
] as const;
export type FbPinRole = (typeof FB_PIN_ROLES)[number];

/** Expected source kind a pin binds to. A per-instance binding (Phase 3.5) may override. */
export const FB_BINDING_SOURCES = [
  "io_input",   // Input image-DB member
  "io_output",  // Output image-DB member
  "fb_output",  // upstream FB instance-DB output
  "hmi",        // HMI / command interface
  "em",         // EM / coordination interface
  "param",      // config constant
] as const;
export type FbBindingSource = (typeof FB_BINDING_SOURCES)[number];

export interface FbInterfacePin {
  /** pin identifier, from SCL */
  name: string;
  /** Bool | Int | Real | … (first token of the SCL type) */
  scl_type: string;
  direction: "input" | "output" | "inout";
  role: FbPinRole;
  /** expected source; a per-instance binding may override */
  default_binding: FbBindingSource;
  /** output that becomes an fb_instance tag once bound */
  exposed: boolean;
  /** from the SCL // comment */
  description: string;
}

export interface FbInterfaceContract {
  /** the main FB block this describes */
  block_name: string;
  pins: FbInterfacePin[];
  /** a human has confirmed the AI-extracted semantic layer */
  reviewed: boolean;
  /** ISO timestamp of the last AI extraction */
  generated_at: string;
}
