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

export interface FbTemplateBlock {
  id: string;
  template_id: string;
  block_name: string;
  block_type: FbBlockType;
  scl_code: string;
  sort_order: number;
  created_at: string;
}

export interface FbTemplate {
  id: string;
  name: string;
  device_category: string;
  plc_brand: string;
  description: string | null;
  ai_summary: string | null;
  version: number;
  tags: string[];
  created_by: string | null;
  updated_at: string;
  created_at: string;
  blocks?: FbTemplateBlock[];
  profile_ids?: string[];
}

export type FbTemplateCreate = Omit<FbTemplate, "id" | "created_at" | "updated_at" | "created_by" | "blocks" | "profile_ids" | "version" | "ai_summary"> & {
  blocks: Array<{ block_name: string; block_type: FbBlockType; scl_code: string; sort_order: number }>;
  profile_ids?: string[];
};

export type FbTemplateUpdate = Partial<FbTemplateCreate>;

export interface FbTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  blocks: Array<{ block_name: string; block_type: string; scl_code: string; sort_order: number }>;
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
