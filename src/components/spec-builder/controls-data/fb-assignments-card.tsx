/**
 * FB Assignments editor (G6-4 "Phase 3.5 Device FB Binding", G0-16).
 * Authoring UI for `engineering.fb_assignments` — the model the compiler
 * already consumes: an assignment FORCES the target's library template
 * (G6-2) and its pin bindings override name matching (G6-3). Targets and
 * their tags derive from the hierarchy so an assignment can only reference
 * legal CMs/EMs; templates filter by target kind + enabled.
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FbTemplate } from "@/types/fb-template";
import type { EngineeringDataV1, FbAssignment } from "@/types/spec-contract-v2";

export interface AssignmentTarget {
  kind: "control_module" | "equipment_module";
  id: string;
  name: string;
  /** IO tags the target owns (EMs: union of their CMs') — the legal binding tags. */
  tags: string[];
}

export function FbAssignmentsCard({
  engineering,
  targets,
  templates,
  onChange,
}: {
  engineering: EngineeringDataV1;
  targets: AssignmentTarget[];
  templates: FbTemplate[];
  onChange: (next: EngineeringDataV1) => void;
}) {
  const assignments = engineering.fb_assignments;
  const targetById = new Map(targets.map((t) => [t.id, t]));
  const templateById = new Map(templates.map((t) => [t.id, t]));

  const patchAssignment = (i: number, patch: Partial<FbAssignment>) =>
    onChange({
      ...engineering,
      fb_assignments: assignments.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    });

  const templatesFor = (kind: AssignmentTarget["kind"]) =>
    templates.filter((t) => t.is_enabled && t.is_equipment_module === (kind === "equipment_module"));

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">FB assignments (library binding)</p>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px]"
          disabled={!targets.length || !templates.length}
          onClick={() => {
            // seed the first target that has a kind-compatible template
            for (const target of targets) {
              const tpl = templatesFor(target.kind)[0];
              if (!tpl) continue;
              onChange({
                ...engineering,
                fb_assignments: [
                  ...assignments,
                  { target_kind: target.kind, target_id: target.id, template_id: tpl.id, pin_bindings: [] },
                ],
              });
              return;
            }
          }}
        >
          <Plus className="h-3 w-3 mr-0.5" />
          Add assignment
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        An assignment forces the target onto its library FB (over auto-match and
        synthesis) and its pin bindings override name matching. A coverage
        failure on an assigned template blocks the build — the mismatch
        surfaces instead of falling back.
      </p>
      {!templates.length ? (
        <p className="text-[10px] text-muted-foreground italic">No FB templates in the library.</p>
      ) : assignments.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">
          No assignments — devices auto-match or synthesize.
        </p>
      ) : (
        <div className="space-y-2">
          {assignments.map((a, i) => {
            const target = targetById.get(a.target_id);
            const tpl = templateById.get(a.template_id);
            const pins = (tpl?.interface_contract?.pins ?? []).filter(
              (p) => p.role === "sensor_in" || p.role === "actuator_out",
            );
            return (
              <div key={i} className="border rounded-md p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Select
                    value={a.target_id}
                    onValueChange={(v) => {
                      const nt = targetById.get(v);
                      if (!nt) return;
                      patchAssignment(i, {
                        target_id: v,
                        target_kind: nt.kind,
                        pin_bindings: [], // bindings are target-specific
                      });
                    }}
                  >
                    <SelectTrigger className="h-6 w-44 text-xs" aria-label={`Assignment ${i + 1} target`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.name}
                          <span className="ml-1 text-muted-foreground">
                            ({t.kind === "equipment_module" ? "EM" : "CM"})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">uses</span>
                  <Select
                    value={a.template_id}
                    onValueChange={(v) => patchAssignment(i, { template_id: v, pin_bindings: [] })}
                  >
                    <SelectTrigger className="h-6 w-52 text-xs" aria-label={`Assignment ${i + 1} template`}>
                      <SelectValue placeholder="template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templatesFor(target?.kind ?? "control_module").map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.name}
                          {t.library_name ? (
                            <span className="ml-1 text-muted-foreground">({t.library_name})</span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove assignment ${i + 1}`}
                    className="h-5 w-5 ml-auto"
                    onClick={() =>
                      onChange({
                        ...engineering,
                        fb_assignments: assignments.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {tpl && !tpl.interface_contract?.pins?.length ? (
                  <p className="pl-2 text-[10px] text-muted-foreground italic">
                    Template has no interface contract — wiring falls back to tag names.
                  </p>
                ) : (
                  <div className="pl-2 space-y-1">
                    {a.pin_bindings.map((b, bi) => (
                      <div key={bi} className="flex items-center gap-1">
                        <Select
                          value={b.pin}
                          onValueChange={(v) =>
                            patchAssignment(i, {
                              pin_bindings: a.pin_bindings.map((x, xj) =>
                                xj === bi ? { ...x, pin: v } : x,
                              ),
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-6 w-40 text-xs font-mono"
                            aria-label={`Assignment ${i + 1} binding ${bi + 1} pin`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {pins.map((p) => (
                              <SelectItem key={p.name} value={p.name} className="text-xs font-mono">
                                {p.name}
                                <span className="ml-1 font-sans text-muted-foreground">({p.role})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-[10px] text-muted-foreground">←</span>
                        <Select
                          value={b.tag}
                          onValueChange={(v) =>
                            patchAssignment(i, {
                              pin_bindings: a.pin_bindings.map((x, xj) =>
                                xj === bi ? { ...x, tag: v } : x,
                              ),
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-6 w-44 text-xs font-mono"
                            aria-label={`Assignment ${i + 1} binding ${bi + 1} tag`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(target?.tags ?? []).map((t) => (
                              <SelectItem key={t} value={t} className="text-xs font-mono">
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove binding ${bi + 1} of assignment ${i + 1}`}
                          className="h-5 w-5"
                          onClick={() =>
                            patchAssignment(i, {
                              pin_bindings: a.pin_bindings.filter((_, xj) => xj !== bi),
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground"
                      disabled={!pins.length || !target?.tags.length}
                      onClick={() =>
                        patchAssignment(i, {
                          pin_bindings: [
                            ...a.pin_bindings,
                            { pin: pins[0].name, tag: target!.tags[0] },
                          ],
                        })
                      }
                    >
                      <Plus className="h-3 w-3 mr-0.5" />
                      pin binding
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
