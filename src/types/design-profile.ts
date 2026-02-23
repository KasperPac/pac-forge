export interface DesignProfile {
  id: string;
  name: string;
  client_name: string | null;
  plc_brand: string;
  rules: string;
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

export type DesignProfileCreate = Omit<
  DesignProfile,
  "id" | "created_at" | "updated_at" | "created_by"
>;

export type DesignProfileUpdate = Partial<DesignProfileCreate>;
