// ---------------------------------------------------------------------------
// Instruction & Function Library Types
// ---------------------------------------------------------------------------

export const INSTRUCTION_CATEGORIES = {
  bit_logic: "Bit Logic",
  timers_counters: "Timers & Counters",
  comparators: "Comparators",
  math: "Math",
  move_convert: "Move / Convert",
  extended: "Extended",
} as const;

export type InstructionCategory = keyof typeof INSTRUCTION_CATEGORIES;

export type InstructionLanguage = "LAD" | "SCL" | "BOTH";

export interface InstructionPin {
  id: string;
  instruction_id: string;
  pin_name: string;
  direction: "in" | "out" | "inout";
  data_type: string;
  is_rung_flow: boolean;
  is_required: boolean;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface Instruction {
  id: string;
  name: string;
  element_type: string;
  category: InstructionCategory;
  description: string | null;
  simatic_part_name: string;
  programming_language: InstructionLanguage;
  supported_platforms: string[];
  is_box: boolean;
  is_output: boolean;
  has_instance: boolean;
  has_operator: boolean;
  operators: string[] | null;
  operator_part_names: Record<string, string> | null;
  notes: string | null;
  verified: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  /** Hydrated child data — populated by hydrateInstructions() */
  pins?: InstructionPin[];
}

export type InstructionCreate = Omit<
  Instruction,
  "id" | "created_at" | "created_by" | "pins"
> & {
  pins: Array<Omit<InstructionPin, "id" | "instruction_id" | "created_at">>;
};

export type InstructionUpdate = Partial<InstructionCreate>;
