/**
 * use-forge-hmi-import.ts
 *
 * Imports HMI screens from TIA Portal (via bridge) into the forge session.
 * Used to import Template Suite framework screens after running the Wizard.
 */

import { useState, useCallback } from "react";
import { parseScreenXml } from "@/lib/hmi-xml-parser";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { HmiScreenSpec } from "@/types/hmi-screen";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

export interface ExportHmiResponse {
  success: boolean;
  message: string;
  screens: Record<string, string>;
  tagTables: Record<string, string>;
  warnings: string[];
}

export interface HmiImportResult {
  screens: HmiScreenSpec[];
  tagTables: Record<string, string>;
  warnings: string[];
}

export function useForgeHmiImport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Export all HMI screens from the TIA project and parse them into HmiScreenSpec.
   * Used to import Template Suite screens after the user runs the Wizard in TIA.
   */
  const importFromTia = useCallback(async (): Promise<HmiImportResult> => {
    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(`${BRIDGE_BASE}/tia/export-hmi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(120_000),
      });

      if (!resp.ok) {
        throw new Error(`Bridge returned ${resp.status}: ${resp.statusText}`);
      }

      const data: ExportHmiResponse = await resp.json();
      if (!data.success) {
        throw new Error(data.message || "HMI export failed");
      }

      // Parse each screen XML into HmiScreenSpec
      const screens: HmiScreenSpec[] = [];
      for (const [name, xml] of Object.entries(data.screens)) {
        try {
          const spec = parseScreenXml(xml);
          // Tag as framework/template_shell if it looks like a Template Suite screen
          if (isTemplateSuiteScreen(spec)) {
            spec.screenRole = "template_shell";
          }
          screens.push(spec);
        } catch (err) {
          console.warn(`[hmi-import] Failed to parse screen "${name}":`, err);
          data.warnings.push(`Failed to parse screen: ${name}`);
        }
      }

      return {
        screens,
        tagTables: data.tagTables,
        warnings: data.warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { importFromTia, loading, error };
}

/**
 * Heuristic: detect if a screen is likely a Template Suite shell/navigation screen.
 * Template Suite screens typically have: SCREEN_WINDOW elements (zone windows),
 * navigation buttons, and a persistent header/footer structure.
 */
function isTemplateSuiteScreen(spec: HmiScreenSpec): boolean {
  const hasScreenWindows = spec.elements.some((e) => e.type === "SCREEN_WINDOW");
  const hasNavButtons = spec.elements.filter(
    (e) => e.type === "BUTTON" && e.navigateTo,
  ).length >= 3;
  // Template Suite shells typically have ScreenWindows as content zones
  return hasScreenWindows && hasNavButtons;
}
