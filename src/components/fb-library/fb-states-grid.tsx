// src/components/fb-library/fb-states-grid.tsx
// EM-only PackML state declaration grid. Every EM FB implements the fixed PackML
// state set (SP-1); this grid declares which states this FB implements + the safe
// state, into interface_contract.states. Mirrors fb-interface-grid.tsx (seed →
// edit → Save sets reviewed:true). Consumed by C5's checkStateCoverage.
import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PACKML_STATES, defaultFbStates } from "@/lib/spec-builder/packml-states";
import { fbMainBlock, seedPinsFromTemplate } from "@/lib/spec-builder/fb-interface";
import type { FbInterfaceContract, FbInterfaceState } from "@/types/fb-interface";
import { useSaveFbInterface } from "@/hooks/use-save-fb-interface";
import type { FbTemplate } from "@/types/fb-template";

function initDeclared(c: FbInterfaceContract | null | undefined): Set<string> {
  const states = c?.states?.length ? c.states : defaultFbStates();
  return new Set(states.map((s) => s.slug));
}
function initSafe(c: FbInterfaceContract | null | undefined): string {
  const states = c?.states?.length ? c.states : defaultFbStates();
  return states.find((s) => s.is_safe)?.slug ?? "aborted";
}

export function FbStatesGrid({ template }: { template: FbTemplate }) {
  const save = useSaveFbInterface();
  const existing = template.interface_contract;
  const [declared, setDeclared] = useState<Set<string>>(() => initDeclared(existing));
  const [safeSlug, setSafeSlug] = useState<string>(() => initSafe(existing));

  // Re-seed when the persisted contract's states change (after Save invalidation).
  const persistedKey = JSON.stringify(existing?.states ?? null);
  useEffect(() => {
    setDeclared(initDeclared(existing));
    setSafeSlug(initSafe(existing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey]);

  // The safe marker must always land on a declared state.
  const effectiveSafe = useMemo(() => {
    if (declared.has(safeSlug)) return safeSlug;
    return (
      PACKML_STATES.find((s) => s.is_safe && declared.has(s.slug))?.slug ??
      PACKML_STATES.find((s) => declared.has(s.slug))?.slug ??
      ""
    );
  }, [declared, safeSlug]);

  if (!template.is_equipment_module) return null;

  const reviewed = existing?.reviewed ?? false;

  function toggleDeclared(slug: string) {
    setDeclared((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function handleSave() {
    const states: FbInterfaceState[] = PACKML_STATES
      .filter((s) => declared.has(s.slug))
      .map((s) => ({ slug: s.slug, name: s.name, is_safe: s.slug === effectiveSafe }));
    const contract: FbInterfaceContract = {
      block_name: existing?.block_name ?? fbMainBlock(template)?.block_name ?? template.name,
      pins: existing?.pins ?? seedPinsFromTemplate(template),
      states,
      reviewed: true,
      generated_at: existing?.generated_at ?? new Date().toISOString(),
    };
    save.mutate({ templateId: template.id, contract });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase text-muted-foreground">PackML States</span>
          {!reviewed && <Badge variant="outline" className="text-amber-600 border-amber-400/50">Needs review</Badge>}
        </div>
        <Button size="sm" variant="ghost" onClick={handleSave} disabled={save.isPending || declared.size === 0}>
          <Save className="h-3.5 w-3.5" /><span className="ml-1">Save</span>
        </Button>
      </div>

      <div className="rounded border border-border/40 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/30 bg-muted/30">
              {["Impl", "#", "State", "Kind", "Safe"].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PACKML_STATES.map((s) => {
              const isDeclared = declared.has(s.slug);
              return (
                <tr key={s.slug} className="border-b border-border/10 hover:bg-muted/20">
                  <td className="px-2 py-0.5">
                    <input type="checkbox" data-testid={`impl-${s.slug}`}
                      checked={isDeclared} onChange={() => toggleDeclared(s.slug)} />
                  </td>
                  <td className="px-2 py-0.5 font-mono text-muted-foreground">{s.packml_id}</td>
                  <td className="px-2 py-0.5 font-mono text-foreground">{s.name}</td>
                  <td className="px-2 py-0.5 font-mono text-muted-foreground">{s.state_pattern}</td>
                  <td className="px-2 py-0.5">
                    <input type="radio" name={`fb-safe-state-${template.id}`} data-testid={`safe-${s.slug}`}
                      disabled={!isDeclared}
                      checked={effectiveSafe === s.slug}
                      onChange={() => setSafeSlug(s.slug)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
