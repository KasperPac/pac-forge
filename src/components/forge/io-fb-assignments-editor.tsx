/**
 * IO FB Assignments Editor — assign IO handling FBs per signal type (DI/DQ/AI/AQ).
 * Used in the design profile detail page alongside FB Favourites.
 */

import { useState } from "react";
import { Cable } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useUpdateDesignProfile } from "@/hooks/use-design-profiles";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";

const IO_SIGNAL_TYPES = [
  { key: "DI", label: "Digital Input", description: "Discrete input signals — push buttons, sensors, limit switches" },
  { key: "DQ", label: "Digital Output", description: "Discrete output signals — contactors, solenoids, pilot lights" },
  { key: "AI", label: "Analog Input", description: "Analog input signals — transmitters, RTDs, load cells (4-20mA)" },
  { key: "AQ", label: "Analog Output", description: "Analog output signals — control valves, VFD speed reference (4-20mA)" },
] as const;

export function IoFbAssignmentsEditor({
  profile,
  templates,
}: {
  profile: DesignProfile;
  templates: FbTemplate[];
}) {
  const updateProfile = useUpdateDesignProfile();
  const [localAssignments, setLocalAssignments] = useState<Record<string, string>>(
    profile.io_fb_assignments ?? {},
  );

  // Filter templates that are likely IO FBs — category contains "io", "analog", "digital"
  // or name contains "IO_", "Input", "Output", "Analog"
  const ioTemplates = templates
    .filter((t) => {
      const cat = t.device_category.toLowerCase();
      const name = t.name.toLowerCase();
      return cat.includes("io") || cat.includes("analog") || cat.includes("digital")
        || name.includes("io_") || name.includes("input") || name.includes("output")
        || name.includes("analog");
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Also include all other templates in a separate group for manual override
  const otherTemplates = templates
    .filter((t) => !ioTemplates.includes(t))
    .sort((a, b) => a.name.localeCompare(b.name));

  function handleChange(signalType: string, templateId: string | null) {
    const next = { ...localAssignments };
    if (templateId) {
      next[signalType] = templateId;
    } else {
      delete next[signalType];
    }
    setLocalAssignments(next);
    updateProfile.mutate({
      id: profile.id,
      updates: { io_fb_assignments: next },
    });
  }

  function handleClearAll() {
    setLocalAssignments({});
    updateProfile.mutate({
      id: profile.id,
      updates: { io_fb_assignments: {} },
    });
  }

  const assignedCount = Object.keys(localAssignments).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cable className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-mono text-sm font-semibold">IO Function Blocks</h3>
        </div>
        {assignedCount > 0 && (
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={handleClearAll}>
            Clear all
          </Button>
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Assign IO handling FBs per signal type. When set, the forge wizard wraps every
        physical IO signal through the assigned FB — providing scaling, filtering, HMI
        binding, manual override, and mode control. The IO FB sits between the raw IO
        tag and the device FB.
      </p>

      <div className="rounded border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-mono text-[10px] uppercase">Signal Type</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase">Description</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase">Assigned FB</th>
            </tr>
          </thead>
          <tbody>
            {IO_SIGNAL_TYPES.map(({ key, label, description }) => {
              const assignedId = localAssignments[key];
              const assignedTemplate = assignedId ? templates.find((t) => t.id === assignedId) : null;

              return (
                <tr key={key} className={`border-b border-border/20 ${assignedId ? "bg-blue-500/5" : ""}`}>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {key}
                    </Badge>
                    <span className="ml-2 font-mono text-xs">{label}</span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{description}</td>
                  <td className="px-3 py-1.5">
                    <Select
                      value={assignedId ?? "__none__"}
                      onValueChange={(v) => handleChange(key, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger className="h-7 w-56 text-xs">
                        <SelectValue>
                          {assignedTemplate ? assignedTemplate.name : "Not set"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground">Not set (direct wiring)</span>
                        </SelectItem>

                        {ioTemplates.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400/70">
                              IO FBs ({ioTemplates.length})
                            </div>
                            {ioTemplates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-1.5">
                                  <span>{t.name}</span>
                                  {t.source === "library" && (
                                    <span className="text-[10px] text-amber-400/60">lib</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </>
                        )}

                        {otherTemplates.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Other ({otherTemplates.length})
                            </div>
                            {otherTemplates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
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
