# Fix: Device Call FCs must use the Matrix wiring data

## Replaces: device-call-fc-cross-wiring-fix.md — discard that version.

## Problem

Each device call FC (ConveyorCall, MotorCall, SensorCall) is generated with context scoped ONLY to its own device type. The AI has no idea which sensors connect to which conveyors, so it wires cross-device inputs to FALSE with TODO comments.

Meanwhile, the Matrix Review step (which runs BEFORE device code) produces a `ProcessLinkageMatrix` with engineer-confirmed wiring for every device — saved to `session.linkage_matrix`. But the device code generation completely ignores it. Zero references to `linkage_matrix` in `use-forge-device-generate.ts`.

## Solution

Pass the matrix wiring data into the device call FC prompts. The matrix already contains exactly what the AI needs:

```typescript
// From session.linkage_matrix.deviceLinkage:
{
  name: "CV01",
  instanceDbName: "InstCV01",
  deviceType: "Conveyor",
  wiring: [
    { paramName: "endSensorForward", direction: "in", connectedTo: "InstPE01._SensorDlyOnOff", wireType: "fb" },
    { paramName: "endSensorReverse", direction: "in", connectedTo: "InstPE02._SensorDlyOnOff", wireType: "fb" },
    { paramName: "jamSensor",        direction: "in", connectedTo: "FALSE",                     wireType: "constant" },
    { paramName: "eStop",            direction: "in", connectedTo: "InstESTOP._SensorDlyOnOff",  wireType: "fb" },
    { paramName: "reset",            direction: "in", connectedTo: "HmiData.resetCommand",       wireType: "global" },
    { paramName: "timeoutDuration",  direction: "in", connectedTo: "Configuration.cv01Timeout",  wireType: "global" },
    { paramName: "runForward",       direction: "out", connectedTo: "HmiData.cv01RunForward",    wireType: "global" },
    // ... etc
  ]
}
```

No guessing. No inferring from descriptions. Just use the matrix.

## Changes

### 1. Add matrix wiring to DeviceCallFcContext

In `src/lib/forge-prompts.ts`, update `DeviceCallFcContext`:

```typescript
export interface DeviceCallFcContext {
  // ... existing fields ...
  
  /** Matrix wiring for all devices of this type — engineer-confirmed connections */
  matrixWiring: Array<{
    deviceName: string;
    instanceDbName: string;
    wiring: FbWire[];
  }>;
}
```

Import `FbWire` from `@/types/process-builder`.

### 2. Pass matrix data in the generation hook

In `src/hooks/use-forge-device-generate.ts`, the `generateAll()` function receives the `session`. Add `session.linkage_matrix` extraction before the device call FC loop:

```typescript
const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;

// Inside the loop for each device type:
const matrixWiring = matrix?.deviceLinkage
  .filter(d => d.deviceType === deviceType)
  .map(d => ({
    deviceName: d.name,
    instanceDbName: d.instanceDbName,
    wiring: d.wiring,
  })) ?? [];

const context: DeviceCallFcContext = {
  // ... existing fields ...
  matrixWiring,
};
```

### 3. Update the device call FC prompt

In `buildDeviceCallFcPrompt()`, add a new section that formats the matrix wiring as the primary wiring reference:

```typescript
const matrixWiringSection = context.matrixWiring.length > 0
  ? context.matrixWiring.map(device => {
      const inputWires = device.wiring
        .filter(w => w.direction === "in")
        .map(w => {
          const source = w.wireType === "io" 
            ? `"${context.inputsDbName}".${w.connectedTo}`
            : w.wireType === "fb"
            ? `"${w.connectedTo.split('.')[0]}".${w.connectedTo.split('.')[1]}`
            : w.wireType === "global"
            ? `"${w.connectedTo.split('.')[0]}".${w.connectedTo.split('.')[1]}`
            : w.connectedTo;
          return `    ${w.paramName} := ${source}`;
        })
        .join(",\n");
      
      const outputWires = device.wiring
        .filter(w => w.direction === "out")
        .map(w => {
          const target = w.wireType === "io"
            ? `"${context.outputsDbName}".${w.connectedTo}`
            : w.wireType === "global"
            ? `"${w.connectedTo.split('.')[0]}".${w.connectedTo.split('.')[1]}`
            : w.connectedTo;
          return `    ${w.paramName} => ${target}`;
        })
        .join(",\n");

      return `### "${device.instanceDbName}" (${device.deviceName})\n\`\`\`\n"${device.instanceDbName}"(\n${inputWires}${outputWires ? ",\n" + outputWires : ""}\n);\n\`\`\``;
    }).join("\n\n")
  : "(no matrix wiring available — infer from device descriptions and FB interfaces)";
```

Add this to the prompt:

```
## ENGINEER-CONFIRMED WIRING (from Matrix Review)
The following wiring has been reviewed and confirmed by the engineer.
Use these EXACT connections. Do NOT change, reorder, or omit any wire.
Do NOT add wires that are not listed here unless they are mandatory FB parameters with no matrix entry.

${matrixWiringSection}
```

### 4. Update the prompt rules

Change rule 5 in the prompt from:
```
5. Inter-device signals (e.g. sensor output feeding conveyor input) use instance DB field access
```

To:
```
5. Inter-device signals MUST match the Matrix wiring above. Do NOT guess or infer connections — the engineer has confirmed the exact wiring. If the matrix says endSensorForward connects to InstPE01._SensorDlyOnOff, write exactly: endSensorForward := "InstPE01"._SensorDlyOnOff
```

### 5. Handle the case where matrix is missing

If `session.linkage_matrix` is null (engineer skipped the matrix step), fall back to the current behaviour — pass all device instances and FB interfaces so the AI can infer. But if the matrix exists, always use it as the primary source.

```typescript
if (matrixWiring.length > 0) {
  // Use matrix — explicit wiring, no guessing
} else {
  // Fallback — pass allDeviceInstances and allFbInterfaces for AI inference
}
```

### 6. Also pass matrix to the process code generation

In `src/hooks/use-forge-process-generate.ts`, the `generateAll()` function should also read `session.linkage_matrix` and pass it into `buildProcessFcPrompt()`. The matrix's `processSequences` array contains structured step transitions with AND/OR combinators, permissives with polarity, and safety conditions — much richer than the simplified `SpecAnalysisProcessSequence`.

Update `ProcessGenContext`:

```typescript
export interface ProcessGenContext {
  // ... existing fields ...
  
  /** Full linkage matrix with device wiring and process sequences */
  linkageMatrix?: ProcessLinkageMatrix;
}
```

In `buildProcessFcPrompt()`, if the matrix exists, use its `processSequences` instead of the spec analysis sequences. The matrix sequences have:
- `safetyConditions` with device references and polarity
- `permissives` with device references and polarity  
- `steps` with structured `transition.conditions` (AND/OR combinators)
- `actions` with device references
- `devicesInvolved` per step

This is vastly more useful than the plain text step/action/criteria from the spec analysis.

### 7. Also pass matrix to the sequence generation

In `generateSequence()`, pass the matrix's matching `processSequence` instead of the `SpecAnalysisProcessSequence`:

```typescript
const matrixSequence = matrix?.processSequences.find(
  s => s.name === sequence.name || s.name.includes(sequence.name.slice(0, 15))
);
```

If a matching matrix sequence exists, format it as the user message with structured transitions, permissives, safety conditions, and device references. If not, fall back to the spec analysis sequence.

---

## Summary of data flow after this fix

```
Spec Upload → PM extracts devices, sequences, alarms
    ↓
Q&A Review → PM fills gaps
    ↓
Hardware & IO → Engineer confirms devices, IO, addresses
    ↓
Matrix Review → AI generates matrix, ENGINEER REVIEWS AND CONFIRMS all wiring
    ↓
Device Code → 
  FBs + instance DBs (from templates or AI)
  Inputs/Outputs DBs (deterministic from IO list)
  IoLinking FC (deterministic — physical IO ↔ Inputs/Outputs DBs)
  Device Call FCs (AI-generated USING MATRIX WIRING — no guessing)
    ↓
Process Code →
  Sequence FBs/FCs (AI-generated USING MATRIX PROCESS SEQUENCES)
  RunProcess FC (AI-generated USING MATRIX DEVICE LINKAGE)
  OB1 Main (deterministic)
```

The matrix is the single source of truth for all wiring. Everything downstream reads from it.

## Files to modify

- `src/lib/forge-prompts.ts` — add matrixWiring to DeviceCallFcContext, update prompt, update ProcessGenContext
- `src/hooks/use-forge-device-generate.ts` — extract matrix data, pass to device call FC generation
- `src/hooks/use-forge-process-generate.ts` — extract matrix data, pass to sequence and RunProcess generation

## Implementation order

1. Add matrixWiring to DeviceCallFcContext and update the prompt
2. Pass matrix data in use-forge-device-generate.ts
3. Update process code generation to use matrix sequences
4. Build and test

Commit with: "forge-arch: use matrix wiring data in device call FC and process code generation"
