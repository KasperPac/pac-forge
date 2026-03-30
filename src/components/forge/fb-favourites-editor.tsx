/**
 * FB Favourites Editor — pin preferred FB templates per device type.
 * Used in the design profile detail page.
 */

import { useState, useMemo } from "react";
import { Star } from "lucide-react";
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

const KNOWN_DEVICE_TYPES = [
  "Motor DOL",
  "Motor VFD",
  "Motor Soft Starter",
  "Motor Simocode",
  "Motor Reversing",
  "Solenoid Valve 2-pos",
  "Analog Valve",
  "Hydraulic Valve",
  "Photoelectric Sensor",
  "Proximity Sensor",
  "Push Button Station",
  "E-Stop Circuit",
  "Stack Light",
  "Conveyor",
  "PID Controller",
];

export function FbFavouritesEditor({
  profile,
  templates,
}: {
  profile: DesignProfile;
  templates: FbTemplate[];
}) {
  const updateProfile = useUpdateDesignProfile();
  const [localFavs, setLocalFavs] = useState<Record<string, string>>(
    profile.fb_favourites ?? {},
  );

  // Merge known types with any custom types from templates
  const allDeviceTypes = useMemo(() => {
    const types = new Set(KNOWN_DEVICE_TYPES);
    // Include any types the user has already pinned (so they remain visible)
    for (const dt of Object.keys(localFavs)) {
      types.add(dt);
    }
    return [...types].sort();
  }, [localFavs]);

  // Group templates by source for the dropdown
  const libraryTemplates = templates.filter((t) => t.source === "library").sort((a, b) => a.name.localeCompare(b.name));
  const customTemplates = templates.filter((t) => t.source !== "library").sort((a, b) => a.name.localeCompare(b.name));

  function handleChange(deviceType: string, templateId: string | null) {
    const next = { ...localFavs };
    if (templateId) {
      next[deviceType] = templateId;
    } else {
      delete next[deviceType];
    }
    setLocalFavs(next);
    // Save immediately
    updateProfile.mutate({
      id: profile.id,
      updates: { fb_favourites: next },
    });
  }

  function handleClearAll() {
    setLocalFavs({});
    updateProfile.mutate({
      id: profile.id,
      updates: { fb_favourites: {} },
    });
  }

  const pinnedCount = Object.keys(localFavs).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            Pin preferred FB templates per device type. Pinned templates are assigned
            automatically in the forge wizard without scoring.
          </p>
        </div>
        {pinnedCount > 0 && (
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={handleClearAll}>
            Clear all ({pinnedCount})
          </Button>
        )}
      </div>

      <div className="rounded border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-mono text-[10px] uppercase">Device Type</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase">Preferred Template</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {allDeviceTypes.map((dt) => {
              const favId = localFavs[dt];
              const favTemplate = favId ? templates.find((t) => t.id === favId) : null;
              const isPinned = !!favId;

              return (
                <tr
                  key={dt}
                  className={`border-b border-border/20 ${isPinned ? "bg-amber-500/5" : ""}`}
                >
                  <td className="px-3 py-1.5 font-mono">
                    <div className="flex items-center gap-1.5">
                      {isPinned && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      {dt}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Select
                      value={favId ?? "__none__"}
                      onValueChange={(v) => handleChange(dt, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger className="h-7 w-64 text-xs">
                        <SelectValue>
                          {favTemplate ? favTemplate.name : "Not set"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground">Not set (use scoring)</span>
                        </SelectItem>

                        {libraryTemplates.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">
                              Library ({libraryTemplates.length})
                            </div>
                            {libraryTemplates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-1.5">
                                  <span>{t.name}</span>
                                  <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
                                    {t.device_category}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </>
                        )}

                        {customTemplates.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Custom ({customTemplates.length})
                            </div>
                            {customTemplates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-1.5">
                                  <span>{t.name}</span>
                                  <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
                                    {t.device_category}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    {isPinned && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        title="Unpin"
                        onClick={() => handleChange(dt, null)}
                      >
                        ×
                      </Button>
                    )}
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
