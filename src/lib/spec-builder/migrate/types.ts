import type {
  OperatorMode,
  CompletionCriterion,
  InterEquipmentModuleInterlockEffect,
} from "@/types/spec-contract-v2";

// ============================================================
// Tab 2 — state vocabulary
// ============================================================

export type StateMappingMatchSource =
  | "exact"          // case-insensitive match against PackML name
  | "synonym"        // synonym map hit
  | "unmapped";      // neither — engineer must decide

export interface ProposedStateMapping {
  legacy_name: string;                        // original string from confirmed_states
  match_source: StateMappingMatchSource;
  // What the engineer will commit. For "unmapped" rows the engineer fills in
  // packml_id or custom_state_id + custom_name. For "exact"/"synonym" rows
  // the proposal is pre-filled and editable.
  packml_id?: number;                         // 1..17
  custom_state_id?: number;                   // > 100
  custom_name?: string;
}

// ============================================================
// Tab 1 — modes
// ============================================================

export interface ProposedModeHint {
  detected_state: string;
  hint: string;                               // human-readable suggestion
}

export interface ProposedModes {
  modes: OperatorMode[];                      // pre-populated [{ auto, default }]
  hints: ProposedModeHint[];
}

// ============================================================
// Tab 3 — interlocks
// ============================================================

export interface ProposedInterlock {
  interlock_id: string;
  source_equipment_module: string;
  target_equipment_module: string;
  original_prose_condition: string;           // legacy free-text source_condition
  original_prose_effect: string;              // legacy free-text effect
  effect: InterEquipmentModuleInterlockEffect;       // AI-classified, editable
  source_condition: CompletionCriterion;      // AI-classified, editable
  confidence: number;                         // 0..1
  reasoning: string;                          // short tooltip
}

// ============================================================
// Migration draft — persisted to spec_projects.migration_draft
// ============================================================

export interface MigrationDraft {
  modes?: { rows: OperatorMode[]; tabComplete: boolean };
  states?: { rows: ProposedStateMapping[]; tabComplete: boolean };
  interlocks?: {
    rows: ProposedInterlock[];
    classifiedAt: string;                     // ISO timestamp
    tabComplete: boolean;
  };
}
