export const PLC_BRANDS = {
  SIEMENS_TIA: "SIEMENS_TIA",
} as const;

export type PlcBrand = (typeof PLC_BRANDS)[keyof typeof PLC_BRANDS];

export const CPU_TYPES = {
  "S7-1200": "S7-1200",
  "S7-1200F": "S7-1200F",
  "S7-1500": "S7-1500",
  "S7-1500F": "S7-1500F",
  "S7-1500T": "S7-1500T",
  "S7-1500TF": "S7-1500TF",
} as const;

export type CpuType = (typeof CPU_TYPES)[keyof typeof CPU_TYPES];

export interface IoEntry {
  address: string;
  tag_name: string;
  data_type: string;
  description: string;
  module: string;
  slot: number;
}

export interface TagDbDefinition {
  name: string;
  tags: Array<{
    name: string;
    data_type: string;
    default_value?: string;
    comment?: string;
  }>;
}

export interface RevisionLogEntry {
  version: string;
  description: string;
  author: string;
  timestamp: string;
}

export interface RackSlotLayout {
  rack: number;
  slots: Array<{
    slot: number;
    module_type: string;
    order_number?: string;
    description?: string;
  }>;
}

export interface Project {
  id: string;
  client_name: string;
  plc_brand: PlcBrand;
  tia_version: string;
  cpu_type: CpuType;
  rack_slot_layout: RackSlotLayout[];
  io_lists: IoEntry[];
  tag_db_definitions: TagDbDefinition[];
  uploaded_docs: string[];
  safety_level: string;
  safety_notes: string;
  revision_log: RevisionLogEntry[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ProjectCreate = Omit<Project, "id" | "created_at" | "updated_at" | "created_by">;

export type ProjectUpdate = Partial<ProjectCreate>;
