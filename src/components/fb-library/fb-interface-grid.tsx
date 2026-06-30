// src/components/fb-library/fb-interface-grid.tsx
// Editable interface-contract grid for the FB Library. Seeds from the SCL parser
// when no contract exists; edits role/binding/exposed; Save sets reviewed:true.
import { useEffect, useState } from "react";
import { Sparkles, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseFbInterface, interfacePins } from "@/lib/spec-builder/fb-interface";
import {
  FB_PIN_ROLES, FB_BINDING_SOURCES,
  type FbInterfaceContract, type FbInterfacePin, type FbPinRole, type FbBindingSource,
} from "@/types/fb-interface";
import { useGenerateFbInterface } from "@/hooks/use-generate-fb-interface";
import { useSaveFbInterface } from "@/hooks/use-save-fb-interface";
import type { FbTemplate } from "@/types/fb-template";

function mainBlock(t: FbTemplate) {
  return t.blocks?.find((b) => b.block_type === "FB") ?? t.blocks?.[0];
}

/** Seed pins from SCL when the template has no contract yet. */
function seedPins(t: FbTemplate): FbInterfacePin[] {
  const block = mainBlock(t);
  if (!block?.scl_code) return [];
  return interfacePins(parseFbInterface(block.scl_code)).map((p) => ({
    name: p.name, scl_type: p.scl_type, direction: p.direction,
    role: (p.direction === "output" ? "status" : "sensor_in") as FbPinRole,
    default_binding: (p.direction === "output" ? "io_output" : "io_input") as FbBindingSource,
    exposed: false, description: p.description,
  }));
}

export function FbInterfaceGrid({ template }: { template: FbTemplate }) {
  const { generate, loadingId } = useGenerateFbInterface();
  const save = useSaveFbInterface();

  const initial = template.interface_contract?.pins ?? seedPins(template);
  const [pins, setPins] = useState<FbInterfacePin[]>(initial);
  const blockName = template.interface_contract?.block_name ?? mainBlock(template)?.block_name ?? template.name;
  const reviewed = template.interface_contract?.reviewed ?? false;

  // Re-seed when the persisted contract changes (after Generate/Save invalidation).
  const persistedKey = JSON.stringify(template.interface_contract?.pins ?? null);
  useEffect(() => {
    setPins(template.interface_contract?.pins ?? seedPins(template));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey]);

  function update(i: number, patch: Partial<FbInterfacePin>) {
    setPins((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function handleSave() {
    const contract: FbInterfaceContract = {
      block_name: blockName, pins,
      states: template.interface_contract?.states ?? [],
      reviewed: true,
      generated_at: template.interface_contract?.generated_at ?? new Date().toISOString(),
    };
    save.mutate({ templateId: template.id, contract });
  }

  if (pins.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase text-muted-foreground">Interface Contract</span>
          {!reviewed && <Badge variant="outline" className="text-amber-600 border-amber-400/50">Needs review</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => generate(template)} disabled={loadingId === template.id}>
            {loadingId === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span className="ml-1">Generate</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSave} disabled={save.isPending}>
            <Save className="h-3.5 w-3.5" /><span className="ml-1">Save</span>
          </Button>
        </div>
      </div>

      <div className="rounded border border-border/40 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/30 bg-muted/30">
              {["Dir", "Name", "Type", "Role", "Binding", "Expose", "Description"].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pins.map((p, i) => (
              <tr key={`${p.name}-${i}`} className="border-b border-border/10 hover:bg-muted/20">
                <td className="px-2 py-0.5 font-mono text-muted-foreground">{p.direction}</td>
                <td className="px-2 py-0.5 font-mono text-foreground">{p.name}</td>
                <td className="px-2 py-0.5 font-mono text-muted-foreground">{p.scl_type}</td>
                <td className="px-2 py-0.5">
                  <select className="bg-transparent font-mono text-[11px]" value={p.role}
                    onChange={(e) => update(i, { role: e.target.value as FbPinRole })}>
                    {FB_PIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-2 py-0.5">
                  <select className="bg-transparent font-mono text-[11px]" value={p.default_binding}
                    onChange={(e) => update(i, { default_binding: e.target.value as FbBindingSource })}>
                    {FB_BINDING_SOURCES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </td>
                <td className="px-2 py-0.5">
                  <input type="checkbox" checked={p.exposed}
                    onChange={(e) => update(i, { exposed: e.target.checked })} />
                </td>
                <td className="px-2 py-0.5 text-muted-foreground">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
