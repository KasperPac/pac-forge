import type { FbInterfaceContract } from "./fb-interface-contract";

export const FB_BLOCK_TYPES = {
  FB: "FB",
  FC: "FC",
  UDT: "UDT",
  DB: "DB",
  OB: "OB",
} as const;

export type FbBlockType = (typeof FB_BLOCK_TYPES)[keyof typeof FB_BLOCK_TYPES];

export interface FbDeviceCategory {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export type FbBlockLanguage = "SCL" | "LAD" | "FBD" | "STL" | "GRAPH";

export interface FbTemplateBlock {
  id: string;
  template_id: string;
  block_name: string;
  block_type: FbBlockType;
  scl_code: string;
  /** Raw SimaticML XML exported from TIA Portal (for LAD/FBD blocks) */
  block_xml: string | null;
  /** Programming language: SCL, LAD, FBD, STL, GRAPH */
  programming_language: FbBlockLanguage;
  sort_order: number;
  created_at: string;
}

export type FbTemplateSource = "custom" | "library" | "standard";

export interface FbTemplate {
  id: string;
  name: string;
  device_category: string;
  plc_brand: string;
  description: string | null;
  ai_summary: string | null;
  diagram_chart: string | null;
  diagram_generated_at: string | null;
  flow_diagram_json: string | null;
  flow_diagram_generated_at: string | null;
  version: number;
  tags: string[];
  /** custom = user-authored | library = imported from TIA library doc | standard = Siemens standard instruction */
  source: FbTemplateSource;
  /** Name of the source library e.g. "LGF V3.1" — set when source = 'library' */
  library_name: string | null;
  /** When false, PM ignores this template entirely (per-library bulk toggle) */
  is_enabled: boolean;
  /** True for assembly-level templates (coordinate groups of devices), false for device-level */
  is_assembly: boolean;
  /** Full manufacturer documentation — wiring, parameters, behaviour, status codes */
  documentation: string | null;
  /** HMI faceplate type name from the library (e.g. "udtHMI_MotorControl") — used by HMI screen generators */
  hmi_faceplate_type: string | null;
  /**
   * Structured declaration of how this template is parameterised + wired.
   * Empty `{}` = contract not yet authored; Co-Author falls back to free-form authoring.
   * See src/types/fb-interface-contract.ts and migration 075.
   */
  interface_contract: FbInterfaceContract | Record<string, never>;
  /** When true, new specs cannot bind to this template; existing bindings keep working. */
  deprecated: boolean;
  created_by: string | null;
  updated_at: string;
  created_at: string;
  blocks?: FbTemplateBlock[];
  profile_ids?: string[];
}

export type FbTemplateCreate = Omit<FbTemplate, "id" | "created_at" | "updated_at" | "created_by" | "blocks" | "profile_ids" | "version" | "ai_summary" | "diagram_chart" | "diagram_generated_at" | "flow_diagram_json" | "flow_diagram_generated_at" | "source" | "library_name" | "is_enabled" | "is_assembly" | "documentation" | "hmi_faceplate_type" | "interface_contract" | "deprecated"> & {
  blocks: Array<{ block_name: string; block_type: FbBlockType; scl_code: string; sort_order: number; block_xml?: string | null; programming_language?: FbBlockLanguage }>;
  profile_ids?: string[];
  source?: FbTemplateSource;
  library_name?: string | null;
  is_enabled?: boolean;
  is_assembly?: boolean;
  documentation?: string | null;
  hmi_faceplate_type?: string | null;
  interface_contract?: FbInterfaceContract;
  deprecated?: boolean;
};

export type FbTemplateUpdate = Partial<FbTemplateCreate>;

export interface FbTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  blocks: Array<{ block_name: string; block_type: string; scl_code: string; sort_order: number; block_xml?: string | null; programming_language?: string }>;
  description: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
}

export interface FbTemplateProfileTag {
  id: string;
  template_id: string;
  profile_id: string;
  created_at: string;
}
