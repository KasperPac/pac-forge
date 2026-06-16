/**
 * plcsim-test-instantiate.ts
 *
 * Resolves parameterized tag placeholders in test templates to produce
 * concrete PlcsimTestCase instances for specific control_modules.
 */

import type { PlcsimTestTemplate } from "@/types/plcsim-test-template";
import type { PlcsimTestCase, TestStep, TestIoAction, IoSimulationRule } from "@/types/plcsim-test";
import type { ForgeControlModuleEntry } from "@/types/forge";
import type { LinkageDevice } from "@/types/forge-matrix";

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------

/**
 * Build a replacement map from the device's wiring and IO signals.
 *
 * Supported placeholders:
 *   {instanceDb}           → device's instance DB name (e.g. "InstFAN01")
 *   {io:TAG_NAME}          → physical IO tag name from device IO signals
 *   {wiring:paramName}     → connectedTo value from device wiring
 *   {config:path}          → configuration DB path from wiring (same as wiring but semantic alias)
 *   {device:name}          → device display name
 *   {device:tag}           → device tag prefix
 */
function buildReplacementMap(
  device: ForgeControlModuleEntry,
  wiring: LinkageDevice | undefined,
): Map<string, string> {
  const map = new Map<string, string>();

  // Instance DB name
  if (wiring?.instanceDbName) {
    map.set("{instanceDb}", wiring.instanceDbName);
  }

  // Device metadata
  map.set("{device:name}", device.name);
  map.set("{device:tag}", device.tag);

  // IO signals — {io:TAG_NAME} → actual tag from IO list
  for (const sig of device.io_signals ?? []) {
    if (sig.tag_name) {
      map.set(`{io:${sig.tag_name}}`, sig.tag_name);
      // Also allow matching by purpose/description
      if (sig.description) {
        map.set(`{io:${sig.description}}`, sig.tag_name);
      }
    }
  }

  // Wiring params — {wiring:paramName} → connectedTo value
  if (wiring?.wiring) {
    for (const wire of wiring.wiring) {
      if (wire.paramName && wire.connectedTo) {
        map.set(`{wiring:${wire.paramName}}`, wire.connectedTo);
        // Also support {config:...} as an alias for configuration wiring
        map.set(`{config:${wire.paramName}}`, wire.connectedTo);
      }
    }
  }

  return map;
}

/**
 * Replace all placeholders in a string using the replacement map.
 * Unresolved placeholders are left as-is (will be visible in the test UI as warnings).
 */
function resolvePlaceholders(text: string, map: Map<string, string>): string {
  let result = text;
  for (const [placeholder, value] of map) {
    result = result.replaceAll(placeholder, value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

function instantiateAction(
  action: TestIoAction,
  map: Map<string, string>,
  idSuffix: string,
): TestIoAction {
  return {
    ...action,
    id: `${action.id}_${idSuffix}`,
    tag: resolvePlaceholders(action.tag, map),
    description: action.description
      ? resolvePlaceholders(action.description, map)
      : action.description,
  };
}

function instantiateStep(
  step: TestStep,
  map: Map<string, string>,
  idSuffix: string,
): TestStep {
  return {
    ...step,
    id: `${step.id}_${idSuffix}`,
    description: step.description
      ? resolvePlaceholders(step.description, map)
      : step.description,
    actions: step.actions.map((a) => instantiateAction(a, map, idSuffix)),
  };
}

/**
 * Instantiate a test template for a specific device.
 * Resolves all tag placeholders and returns a concrete PlcsimTestCase
 * with `approved: true` (it's a proven template).
 */
export function instantiateTestTemplate(
  template: PlcsimTestTemplate,
  device: ForgeControlModuleEntry,
  wiring: LinkageDevice | undefined,
): PlcsimTestCase {
  const map = buildReplacementMap(device, wiring);
  const idSuffix = device.tag.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const tc = template.test_case;

  return {
    ...tc,
    id: `tmpl_${template.id.slice(0, 8)}_${idSuffix}`,
    name: resolvePlaceholders(tc.name, map).replace("{device:name}", device.name),
    description: tc.description
      ? resolvePlaceholders(tc.description, map)
      : `Template test for ${device.name}`,
    steps: tc.steps.map((s) => instantiateStep(s, map, idSuffix)),
    approved: true,
  };
}

/**
 * Instantiate sim rules from a template for a specific device.
 */
export function instantiateSimRules(
  rules: IoSimulationRule[],
  device: ForgeControlModuleEntry,
  wiring: LinkageDevice | undefined,
): IoSimulationRule[] {
  const map = buildReplacementMap(device, wiring);
  const idSuffix = device.tag.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

  return rules.map((rule) => ({
    ...rule,
    id: `${rule.id}_${idSuffix}`,
    triggerTag: resolvePlaceholders(rule.triggerTag, map),
    responseTag: resolvePlaceholders(rule.responseTag, map),
    description: rule.description
      ? resolvePlaceholders(rule.description, map)
      : rule.description,
  }));
}

// ---------------------------------------------------------------------------
// Template matching — find the best template for a device
// ---------------------------------------------------------------------------

/**
 * Find the best matching test template for a device.
 * Priority: FB-specific template > category-level template.
 */
export function findMatchingTemplate(
  templates: PlcsimTestTemplate[],
  device: ForgeControlModuleEntry,
): PlcsimTestTemplate | null {
  // 1. Try FB-specific match
  if (device.fb_template_id) {
    const fbMatch = templates.find(
      (t) => t.fb_template_id === device.fb_template_id,
    );
    if (fbMatch) return fbMatch;
  }

  // 2. Try category match
  const categoryMatch = templates.find(
    (t) =>
      t.device_category != null &&
      t.fb_template_id == null &&
      t.device_category.toLowerCase() === device.device_type.toLowerCase(),
  );
  if (categoryMatch) return categoryMatch;

  return null;
}
