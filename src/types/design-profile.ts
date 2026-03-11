export interface ProcessRuleExample {
  label: string;
  example: string;
  analysis: string;
  /** Base64 data URIs of uploaded screenshots */
  screenshots?: string[];
}

export interface DesignProfile {
  id: string;
  name: string;
  client_name: string | null;
  plc_brand: string;
  /** @deprecated Use general_rules instead. Kept for backward compat. */
  rules: string;
  general_rules: string;
  folder_rules: string;
  process_rules: ProcessRuleExample[];
  fb_rules: ProcessRuleExample[];
  /** Primary code language for device FBs (migration 025) */
  code_language: "SCL" | "LAD" | "MIXED";
  /** Language override for process/sequence code (migration 025) */
  process_code_language: "SCL" | "LAD" | "MIXED";
  /** HMI screen theme identifier (migration 025) */
  hmi_theme: string;
  /** FB/FC naming prefix for customer, e.g. "FB_CK_" (migration 025) */
  naming_prefix: string;
  /** DB naming prefix for customer, e.g. "DB_CK_" (migration 025) */
  db_naming_prefix: string;
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

export type DesignProfileCreate = Omit<
  DesignProfile,
  "id" | "created_at" | "updated_at" | "created_by"
>;

export type DesignProfileUpdate = Partial<DesignProfileCreate>;
