/**
 * VFD FB family registry — the single source of truth for what each
 * `VfdFamily` maps to (G1-6):
 *
 *  - `deterministic_fb` — the Siemens standard driver FB the deterministic
 *    compiler emits (drive-detect/G1-2). Absent = no deterministic template;
 *    vendor blocks come via the FB library / fb_assignments and the MAP
 *    emission stays a `// TODO`.
 *  - `fb_name` + `parameter_defaults` — the legacy forge/AI wrapper seeds
 *    (use-forge-device-generate). Consumers merge defaults with
 *    `network_config.vfd_params` and seed the instance DB.
 *
 * Pure & stateless: no React, no DB.
 */
import type { VfdFamily } from "@/types/spec-contract-v2";

export interface VfdFbTemplate {
  /** Deterministic driver FB (Siemens standard block) — consumed by the
   *  deterministic compiler. Absent = library/fb_assignments territory. */
  deterministic_fb?: string;
  /** Forge/AI wrapper FB name (legacy path). */
  fb_name: string;
  parameter_defaults: Record<string, unknown>;
  supported_telegrams?: number[];
  notes?: string;
}

const TEMPLATES: Record<VfdFamily, VfdFbTemplate> = {
  sinamics_g120: {
    deterministic_fb: "SINA_SPEED",
    fb_name: "SINA_SPEED",
    parameter_defaults: { HWID: 0, DELTA_RAMP_DOWN_S: 5.0 },
    supported_telegrams: [1, 20, 352],
  },
  sinamics_s210: {
    deterministic_fb: "SINA_POS",
    fb_name: "SINAMICS_Control_S210",
    parameter_defaults: {},
    supported_telegrams: [102, 105],
  },
  abb_acs880: {
    fb_name: "ACS880_FB",
    parameter_defaults: {},
    notes: "EtherNet/IP equipment_module instances required in network_config",
  },
  sew_movidrive: {
    fb_name: "MOVIKIT_BasicFlexi",
    parameter_defaults: {},
  },
  other: {
    fb_name: "VFD_Generic",
    parameter_defaults: {},
  },
};

export function getVfdFbTemplate(family: string): VfdFbTemplate {
  const tpl = TEMPLATES[family as VfdFamily];
  if (tpl) return tpl;
  console.warn(`[vfd-fb-family] Unknown VFD family "${family}", falling back to generic`);
  return TEMPLATES.other;
}

/** Deterministic driver FB for a family (undefined = none — TODO path). */
export function deterministicDriveFb(family: VfdFamily): string | undefined {
  return TEMPLATES[family]?.deterministic_fb;
}
