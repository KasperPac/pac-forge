/**
 * Engineering Data editor (tier 2, G0-16 W1 slice 4) — commissioned values
 * the writers join at codegen time: per-drive constants (RefSpeed = p2000,
 * HW ids), per-axis commissioned constants, and encoder-preset TR channels.
 * Rows are DERIVED from what tier 1 declares (CMs with a drive model, axes,
 * presettable axes) so entries can only reference legal targets.
 */
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  AxisConstantEntry,
  AxisV1,
  DriveEngineeringEntry,
  EncoderPresetEntry,
  EngineeringDataV1,
} from "@/types/spec-contract-v2";

export interface DriveCmRef {
  cmId: string;
  cmName: string;
  family: string;
}

export interface UnitAxisRef {
  unitId: string;
  unitName: string;
  axis: AxisV1;
}

/** Declared config-DB members of an axis (the legal axis-constant keys). */
function axisParamMembers(axis: AxisV1): string[] {
  return axis.kind === "linear"
    ? [axis.scale.db_member, axis.length.db_member, axis.end_margin.db_member, axis.ramp_zone.db_member]
    : [axis.counts_per_rev.db_member];
}

function numInput(
  label: string,
  value: number | undefined,
  set: (v: number | undefined) => void,
  width = "w-24",
) {
  return (
    <Input
      type="number"
      aria-label={label}
      value={value ?? ""}
      placeholder="—"
      onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
      className={`h-6 ${width} text-xs font-mono`}
    />
  );
}

export function EngineeringCard({
  engineering,
  driveCms,
  unitAxes,
  onChange,
}: {
  engineering: EngineeringDataV1;
  driveCms: DriveCmRef[];
  unitAxes: UnitAxisRef[];
  onChange: (next: EngineeringDataV1) => void;
}) {
  // ---- drives (keyed by CM id; entry exists once any field is set) ----
  const driveEntry = (cmId: string): DriveEngineeringEntry | undefined =>
    engineering.drives.find((d) => d.control_module_id === cmId);
  const patchDrive = (cmId: string, patch: Partial<DriveEngineeringEntry>) => {
    const existing = driveEntry(cmId);
    const next: DriveEngineeringEntry = {
      control_module_id: cmId,
      config_axis: 0x003f,
      ...existing,
      ...patch,
    };
    const empty =
      next.ref_speed_rpm === undefined &&
      next.hw_id_stw === undefined &&
      next.hw_id_zsw === undefined &&
      next.io_in_start_byte === undefined &&
      next.io_out_start_byte === undefined;
    onChange({
      ...engineering,
      drives: empty
        ? engineering.drives.filter((d) => d.control_module_id !== cmId)
        : [...engineering.drives.filter((d) => d.control_module_id !== cmId), next],
    });
  };

  // ---- axis constants (keyed by unit+axis; values keyed by db_member) ----
  const axisEntry = (unitId: string, axisId: string): AxisConstantEntry | undefined =>
    engineering.axis_constants.find((a) => a.unit_id === unitId && a.axis_id === axisId);
  const patchAxisConstant = (unitId: string, axisId: string, member: string, v: number | undefined) => {
    const existing = axisEntry(unitId, axisId);
    const values = { ...existing?.values };
    if (v === undefined) delete values[member];
    else values[member] = v;
    const rest = engineering.axis_constants.filter(
      (a) => !(a.unit_id === unitId && a.axis_id === axisId),
    );
    onChange({
      ...engineering,
      axis_constants: Object.keys(values).length
        ? [...rest, { unit_id: unitId, axis_id: axisId, values, notes: existing?.notes }]
        : rest,
    });
  };

  // ---- encoder-preset channels (presettable axes only) ----
  const presetEntry = (unitId: string, axisId: string): EncoderPresetEntry | undefined =>
    engineering.encoder_presets.find((p) => p.unit_id === unitId && p.axis_id === axisId);
  const patchPreset = (unitId: string, axisId: string, patch: Partial<EncoderPresetEntry>) => {
    const existing = presetEntry(unitId, axisId);
    const next: EncoderPresetEntry = {
      unit_id: unitId,
      axis_id: axisId,
      ctrl_address: "",
      value_address: "",
      status_address: "",
      ...existing,
      ...patch,
    };
    const empty = !next.ctrl_address && !next.value_address && !next.status_address;
    onChange({
      ...engineering,
      encoder_presets: empty
        ? engineering.encoder_presets.filter((p) => !(p.unit_id === unitId && p.axis_id === axisId))
        : [
            ...engineering.encoder_presets.filter(
              (p) => !(p.unit_id === unitId && p.axis_id === axisId),
            ),
            next,
          ],
    });
  };

  const presettableAxes = unitAxes.filter((ua) => !!ua.axis.preset);

  return (
    <div className="space-y-4">
      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold">Drive commissioning values</p>
        <p className="text-[10px] text-muted-foreground">
          Recorded per VSD control module. RefSpeed MUST equal the drive's p2000;
          HW ids come from the TIA hardware config. Missing values emit TODOs, never guesses.
        </p>
        {driveCms.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic">
            No control modules carry a drive model (add one in the hierarchy table).
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground uppercase">
              <span className="w-36">CM</span>
              <span className="w-24">RefSpeed rpm</span>
              <span className="w-24">HWIDSTW</span>
              <span className="w-24">HWIDZSW</span>
              <span className="w-24">IW start</span>
              <span className="w-24">QW start</span>
            </div>
            {driveCms.map((cm) => {
              const e = driveEntry(cm.cmId);
              return (
                <div key={cm.cmId} className="flex items-center gap-1.5">
                  <span className="w-36 text-xs font-mono truncate" title={cm.family}>
                    {cm.cmName}
                  </span>
                  {numInput(`${cm.cmName} ref speed rpm`, e?.ref_speed_rpm, (v) =>
                    patchDrive(cm.cmId, { ref_speed_rpm: v }),
                  )}
                  {numInput(`${cm.cmName} HWIDSTW`, e?.hw_id_stw, (v) =>
                    patchDrive(cm.cmId, { hw_id_stw: v }),
                  )}
                  {numInput(`${cm.cmName} HWIDZSW`, e?.hw_id_zsw, (v) =>
                    patchDrive(cm.cmId, { hw_id_zsw: v }),
                  )}
                  {numInput(`${cm.cmName} IW start byte`, e?.io_in_start_byte, (v) =>
                    patchDrive(cm.cmId, { io_in_start_byte: v }),
                  )}
                  {numInput(`${cm.cmName} QW start byte`, e?.io_out_start_byte, (v) =>
                    patchDrive(cm.cmId, { io_out_start_byte: v }),
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold">Axis commissioned constants</p>
        <p className="text-[10px] text-muted-foreground">
          Measured on site (e.g. counts per 360°, mm per rev ×10). The runtime
          value lives in the PLC's RETAIN config DB; this records the constant.
        </p>
        {unitAxes.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic">
            No axes declared (add them under Unit Coordination).
          </p>
        ) : (
          <div className="space-y-2">
            {unitAxes.map(({ unitId, unitName, axis }) => (
              <div key={`${unitId}:${axis.axis_id}`} className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground">
                  {unitName} · <span className="font-mono">{axis.axis_id}</span>
                </p>
                {axisParamMembers(axis).map((member) => (
                  <div key={member} className="flex items-center gap-1.5 pl-2">
                    <span className="w-36 text-[10px] font-mono text-muted-foreground">{member}</span>
                    {numInput(
                      `${axis.axis_id} ${member} constant`,
                      axisEntry(unitId, axis.axis_id)?.values[member],
                      (v) => patchAxisConstant(unitId, axis.axis_id, member, v),
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold">Encoder-preset channels</p>
        <p className="text-[10px] text-muted-foreground">
          TR-profile preset submodule addresses per presettable axis (control
          byte %QB, value %QD, status %IB). The G3 sequencer emits from these.
        </p>
        {presettableAxes.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic">
            No presettable axes (flag the encoder as presettable on the axis).
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground uppercase">
              <span className="w-36">Axis</span>
              <span className="w-24">ctrl</span>
              <span className="w-24">value</span>
              <span className="w-24">status</span>
            </div>
            {presettableAxes.map(({ unitId, unitName, axis }) => {
              const e = presetEntry(unitId, axis.axis_id);
              const addrInput = (
                key: "ctrl_address" | "value_address" | "status_address",
                ph: string,
              ) => (
                <Input
                  aria-label={`${axis.axis_id} ${key.replace("_", " ")}`}
                  value={e?.[key] ?? ""}
                  placeholder={ph}
                  onChange={(ev) => patchPreset(unitId, axis.axis_id, { [key]: ev.target.value })}
                  className="h-6 w-24 text-xs font-mono"
                />
              );
              return (
                <div key={`${unitId}:${axis.axis_id}`} className="flex items-center gap-1.5">
                  <span className="w-36 text-xs font-mono truncate" title={unitName}>
                    {axis.axis_id}
                  </span>
                  {addrInput("ctrl_address", "%QB70")}
                  {addrInput("value_address", "%QD71")}
                  {addrInput("status_address", "%IB78")}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
