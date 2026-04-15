import type { PlcsimTestCase, IoSimulationRule } from "./plcsim-test";

// ---------------------------------------------------------------------------
// Tag mapping — how template placeholders resolve to real tags per device
// ---------------------------------------------------------------------------

export type TagResolveSource = "instanceDb" | "wiring" | "io_list" | "config";

export interface TagMapping {
  /** Placeholder string used in test actions, e.g. "{instanceDb}", "{io:ESTOP_OK}" */
  placeholder: string;
  /** How to resolve this placeholder */
  resolve_from: TagResolveSource;
  /** Parameter/tag name used for resolution (e.g., wiring param name, IO tag name) */
  param_name?: string;
  /** Human-readable description */
  description?: string;
}

// ---------------------------------------------------------------------------
// Test template — reusable test procedure tied to device category or FB
// ---------------------------------------------------------------------------

export interface PlcsimTestTemplate {
  id: string;
  name: string;
  /** Device category scope — e.g. "Motor", "Valve". Matches fb_device_categories.name */
  device_category: string | null;
  /** Specific FB template scope — overrides category-level when both exist */
  fb_template_id: string | null;
  description: string | null;
  /** The template test procedure — PlcsimTestCase shape with parameterized tags */
  test_case: PlcsimTestCase;
  /** Optional sim rules bundled with this template */
  sim_rules?: IoSimulationRule[];
  /** Tag placeholder → resolution rules */
  tag_mappings: TagMapping[];
  is_enabled: boolean;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Hydrated client-side — profile IDs for scoping */
  profile_ids?: string[];
  /** Hydrated client-side — FB template name for display */
  fb_template_name?: string;
}

export type PlcsimTestTemplateCreate = Pick<
  PlcsimTestTemplate,
  "name" | "device_category" | "fb_template_id" | "description" | "test_case" | "sim_rules" | "tag_mappings"
> & {
  profile_ids?: string[];
};

export type PlcsimTestTemplateUpdate = Partial<
  Pick<
    PlcsimTestTemplate,
    "name" | "device_category" | "fb_template_id" | "description" | "test_case" | "sim_rules" | "tag_mappings" | "is_enabled"
  >
> & {
  profile_ids?: string[];
};
