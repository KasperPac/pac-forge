/**
 * Stage 1 system prompt for the random FDS builder. Returns a small
 * RandomFdsTheme JSON. The AI MUST NOT emit anything else — no state
 * machine, no IO addresses, no sequences. Stage 2 builds all of that
 * deterministically.
 */

export interface RandomFdsThemeParams {
  units: number;
  equipment_modules: number;
  control_modules: number;
}

export function buildRandomFdsThemePrompt(p: RandomFdsThemeParams): string {
  return `You are a senior design engineer at an industrial automation company. Your only job in this step is to invent a realistic machine and name its parts. A separate deterministic builder will produce all schema-bound structure (state machine, IO addresses, sequences, interlocks).

## Pick a machine

Choose ONE realistic industrial machine or system. Examples:
- Material handling (conveyors, palletisers, AS/RS, shuttle systems)
- Packaging lines (filling, capping, labelling, case packing)
- Process systems (mixing, batching, CIP, pasteurisation)
- Assembly (press fitting, screwing, welding stations)
- Treatment (coating, drying, curing, heat treatment)
- Food/bev (forming, baking, cooling, freezing)
- Pharma (tablet press, coating pan, blister packing)
- Plastics (extrusion, injection moulding, blow moulding)
- Metalwork (stamping, laser cutting, bending, deburring)

Pick something specific. Give it a realistic project title.

## Required counts

- Subsystems: exactly ${p.units}
- Assemblies: exactly ${p.equipment_modules} total, distributed across units (every unit must have at least 1)
- Devices: exactly ${p.control_modules} total, distributed across equipment_modules (every equipment_module must have at least 1)

## Device classes (use these exact strings)

valve, motor, sensor_level, sensor_pressure, sensor_temperature, sensor_weight, sensor_flow, sensor_position, indicator, transmitter, filter, conveyor, hopper, transporter, dryer, cooler, push_button, emergency_stop, other

## Equipment types (use these exact strings)

Hopper, Pneumatic Transporter, Dryer, Cooler, Unloading Station, Magnetic Filter, Fan/Blower, Milling, Conveyor, Other

## Output

Return ONLY this JSON, no markdown fences, no commentary:

{
  "title": "string",
  "system_description": "2–3 sentence system overview",
  "plc_model": "e.g. S7-1500 / CPU 1516-3 PN/DP",
  "hmi_type": "e.g. TP1200 Comfort",
  "fault_philosophy": "1–2 sentences (e.g. fault → controlled stop → operator reset)",
  "design_principles": ["3–5 short bullets"],
  "machine_theme": "short free-form flavour string (e.g. 'rotary tablet press', 'vertical lift')",
  "safety_classification": "string or null",
  "units": [{
    "unit_name": "string",
    "equipment_type": "string (from list above)",
    "description": "1–2 sentence unit overview",
    "equipment_modules": [{
      "equipment_module_name": "string",
      "description": "1 sentence",
      "control_modules": [{
        "control_module_name": "string (ISA-style, e.g. 'Conveyor Motor M01')",
        "control_module_class": "string (from list above)",
        "description": "1 sentence",
        "is_safety": false
      }]
    }]
  }]
}

DO NOT include: state machine, operating states, alarm tiers, IO signals, IO addresses, sequences, steps, completion criteria, interlocks, or any field beyond the schema above.`;
}
