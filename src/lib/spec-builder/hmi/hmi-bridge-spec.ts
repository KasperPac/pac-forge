// src/lib/spec-builder/hmi/hmi-bridge-spec.ts
//
// G7-8 lowering #1 — HMI IR → the bridge's POST /tia/hmi/build request JSON
// (shape of record: TiaPortalService.HmiUnified.cs BuildHmi). Everything the
// bridge can build natively is emitted; capabilities it lacks (Unified text
// lists, roles, alarm controls, button press/release events — the G8-3/G8-4
// gaps) come back as `manualSteps` and are fully specified in the build-pack
// markdown instead. Trigger modes verified against the Openness catalogue:
// HmiDiscreteAlarmTriggerMode.OnRisingEdge / OnFallingEdge.
import type { HmiIr, HmiScreen, HmiScreenItem } from "./hmi-ir";

const LAMP_OFF = "#CDD3D7";
const LAMP_ON = "#00CC00";
const ROW_H = 40;
const LABEL_W = 220;
const FIELD_W = 140;

export interface HmiBridgeBuild {
  spec: Record<string, unknown>;
  /** Capabilities the bridge cannot author natively yet — the build-pack
   *  markdown carries the full instructions for each. */
  manualSteps: string[];
}

function tagNameFor(ir: HmiIr, plcTag: string): string {
  return ir.tags.find((t) => t.plcTag === plcTag)?.name ?? plcTag.replace(/\./g, "_");
}

function lowerItem(
  ir: HmiIr,
  item: HmiScreenItem,
  row: number,
  manualSteps: string[],
): Record<string, unknown>[] {
  const top = 8 + row * ROW_H;
  const label = (text: string): Record<string, unknown> => ({
    type: "Label",
    name: `lbl_${row}`,
    text,
    left: 8,
    top,
    width: LABEL_W,
    height: ROW_H - 8,
  });
  switch (item.kind) {
    case "state_field":
      manualSteps.push(
        `Bind text list "${item.textList}" to the state field for ${item.tag} (Unified text-list authoring pending Openness verification — G8-4).`,
      );
      return [
        label(item.label),
        {
          type: "IOField", name: `st_${row}`, tag: tagNameFor(ir, item.tag),
          mode: "Output", left: 8 + LABEL_W, top, width: FIELD_W, height: ROW_H - 8,
        },
      ];
    case "numeric_field":
      return [
        label(item.unit ? `${item.label} (${item.unit})` : item.label),
        {
          type: "IOField", name: `num_${row}`, tag: tagNameFor(ir, item.tag),
          mode: item.writable ? "InputOutput" : "Output",
          left: 8 + LABEL_W, top, width: FIELD_W, height: ROW_H - 8,
        },
      ];
    case "lamp":
      return [
        label(item.label),
        {
          type: "Circle", name: `lamp_${row}`, left: 8 + LABEL_W, top, radius: 12,
          backColor: item.onValue === 1 ? LAMP_OFF : LAMP_ON,
          dynamizations: [
            {
              property: "BackColor",
              tag: tagNameFor(ir, item.tag),
              singleBit:
                item.onValue === 1
                  ? { off: LAMP_OFF, on: LAMP_ON }
                  : { off: LAMP_ON, on: LAMP_OFF },
            },
          ],
        },
      ];
    case "toggle":
      return [
        {
          type: "ToggleSwitch", name: `tgl_${row}`, text: item.label,
          tag: tagNameFor(ir, item.tag),
          left: 8, top, width: LABEL_W + FIELD_W, height: ROW_H - 8,
        },
      ];
    case "button_momentary":
      manualSteps.push(
        `Wire press/release events on button "${item.label}" → set/reset ${item.tag} (Unified JS event scripts; the PLC sequencer needs only a pulse).`,
      );
      return [
        {
          type: "Button", name: `btn_${row}`, text: item.label,
          left: 8, top, width: LABEL_W + FIELD_W, height: ROW_H - 8,
        },
      ];
    case "alarm_control":
      manualSteps.push(
        `Place a Unified Alarm control (active + logged tabs) plus an ACK button on the Alarms screen (HmiAlarmControl creation not in the bridge yet).`,
      );
      return [label(`${item.label} — add Alarm control manually`)];
  }
}

function lowerScreen(ir: HmiIr, screen: HmiScreen, manualSteps: string[]): Record<string, unknown> {
  const items = screen.items.flatMap((it, row) => lowerItem(ir, it, row, manualSteps));
  if (screen.requiredLevel !== undefined) {
    manualSteps.push(
      `Restrict screen "${screen.name}" to role level ≥ ${screen.requiredLevel} (role creation pending Openness verification — G8-3).`,
    );
  }
  return { name: screen.name, clear: true, items };
}

/** Lower the IR to the bridge build request. `connection` is the HMI
 *  connection name in the TIA project (created via the Networks editor). */
export function buildHmiBridgeSpec(ir: HmiIr, opts?: { connection?: string; tagTable?: string }): HmiBridgeBuild {
  const manualSteps: string[] = [];
  for (const list of ir.textLists) {
    manualSteps.push(
      `Create text list "${list.name}" (${list.entries.map((e) => `${e.index}=${e.text}`).join(" · ")}).`,
    );
  }
  for (const role of ir.roles) {
    manualSteps.push(`Create role "${role.name}" (level ${role.level}) — G8-3.`);
  }
  const spec: Record<string, unknown> = {
    ...(opts?.connection ? { connection: opts.connection } : {}),
    ...(opts?.tagTable ? { tagTable: opts.tagTable } : {}),
    tags: ir.tags.map((t) => ({ name: t.name, plcTag: t.plcTag })),
    alarms: ir.alarms.map((a, i) => ({
      name: `AL_${String(i + 1).padStart(3, "0")}`,
      tag: tagNameFor(ir, a.tag),
      trigger: a.triggerValue === 1 ? "OnRisingEdge" : "OnFallingEdge",
      class: a.className,
      text: a.text,
    })),
    screens: ir.screens.map((s) => lowerScreen(ir, s, manualSteps)),
  };
  return { spec, manualSteps };
}
