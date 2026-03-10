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
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

export type DesignProfileCreate = Omit<
  DesignProfile,
  "id" | "created_at" | "updated_at" | "created_by"
>;

export type DesignProfileUpdate = Partial<DesignProfileCreate>;
