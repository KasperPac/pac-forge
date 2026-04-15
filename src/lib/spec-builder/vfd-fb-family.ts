/**
 * VFD FB family templates — maps a `VfdFamily` identifier to an FB wrapper
 * name + default parameter seeds. Used by forge device generation when a
 * device carries `network_config.vfd_family`.
 *
 * Pure & stateless: no React, no DB. Consumers are responsible for merging
 * the defaults with `device.network_config.vfd_params` and for seeding the
 * instance DB.
 */

export interface VfdFbTemplate {
  fb_name: string;
  parameter_defaults: Record<string, unknown>;
  supported_telegrams?: number[];
  notes?: string;
}

const TEMPLATES: Record<string, VfdFbTemplate> = {
  sinamics_g120: {
    fb_name: "SINA_SPEED",
    parameter_defaults: { HWID: 0, DELTA_RAMP_DOWN_S: 5.0 },
    supported_telegrams: [1, 20, 352],
  },
  sinamics_s210: {
    fb_name: "SINAMICS_Control_S210",
    parameter_defaults: {},
    supported_telegrams: [102, 105],
  },
  abb_acs880: {
    fb_name: "ACS880_FB",
    parameter_defaults: {},
    notes: "EtherNet/IP assembly instances required in network_config",
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
  const tpl = TEMPLATES[family];
  if (tpl) return tpl;
  console.warn(`[vfd-fb-family] Unknown VFD family "${family}", falling back to generic`);
  return TEMPLATES.other;
}
