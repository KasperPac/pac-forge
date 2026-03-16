# Fix: Hardware module recommendation + IO address assignment + missing outputs

## Problem 1: Recommend Modules doesn't account for onboard CPU IO

The `recommendModules()` function in `src/components/forge/steps/forge-hardware-io.tsx` counts total DI/DQ/AI/AQ needed from all devices and suggests modules for the full count. But the CPU has onboard IO (e.g. 1511C-1 PN has 16 DI, 16 DQ, 5 AI, 2 AQ). It should only recommend modules for the OVERFLOW beyond what the CPU provides.

### Fix:

The module catalog (`src/lib/module-catalog.ts`) or the address calculator likely has CPU onboard IO counts. If not, add a lookup:

```typescript
const CPU_ONBOARD_IO: Record<string, { di: number; dq: number; ai: number; aq: number }> = {
  "S7-1511C-1 PN": { di: 16, dq: 16, ai: 5, aq: 2 },
  "S7-1512C-1 PN": { di: 32, dq: 32, ai: 5, aq: 2 },
  "S7-1500": { di: 0, dq: 0, ai: 0, aq: 0 },  // Non-C variants have no onboard IO
  "S7-1200": { di: 0, dq: 0, ai: 0, aq: 0 },
  // Add more as needed — check from the existing module catalog
};
```

Check if this data already exists in `src/lib/module-catalog.ts` or `src/lib/address-calculator.ts` before creating a duplicate.

Update `recommendModules()`:

```typescript
function recommendModules() {
  const counts = countIoSignals(devices);
  
  // Subtract onboard CPU IO
  const cpuIo = CPU_ONBOARD_IO[hardware.cpu_type] ?? { di: 0, dq: 0, ai: 0, aq: 0 };
  const overflow = {
    DI: Math.max(0, counts.DI - cpuIo.di),
    DQ: Math.max(0, counts.DQ - cpuIo.dq),
    AI: Math.max(0, counts.AI - cpuIo.ai),
    AQ: Math.max(0, counts.AQ - cpuIo.aq),
  };
  
  // Only recommend modules for the overflow
  const recommended = [
    ...bestModule("DI", overflow.DI),
    ...bestModule("DQ", overflow.DQ),
    ...bestModule("AI", overflow.AI),
    ...bestModule("AQ", overflow.AQ),
  ];
  
  // Show a summary to the engineer
  // "CPU onboard: 16 DI, 16 DQ, 5 AI, 2 AQ | Needed: 17 DI, 6 DQ, 0 AI, 0 AQ | Overflow: 1 DI"
}
```

Also display the onboard IO vs required IO as a summary above the hardware table so the engineer can see at a glance whether expansion modules are needed.

---

## Problem 2: IO addresses are all blank (%I0.0 or empty)

The `generateIoListFromDevices()` function creates IO entries with `address: ""`. It never assigns proper Siemens addresses (%I0.0, %I0.1, %Q0.0, etc.).

### Fix:

After generating the IO list from devices, use the existing address calculator to assign addresses. The system already has `src/lib/address-calculator.ts` with `calculateRackAddresses()` and `calculateEt200spAddresses()` functions.

Update `generateIoListFromDevices()`:

```typescript
function generateIoListFromDevices() {
  const newIo: ForgeIoEntry[] = [];
  
  // Separate by signal type for address assignment
  const diSignals: ForgeIoEntry[] = [];
  const dqSignals: ForgeIoEntry[] = [];
  const aiSignals: ForgeIoEntry[] = [];
  const aqSignals: ForgeIoEntry[] = [];
  
  for (const device of devices) {
    for (const sig of device.io_signals) {
      const entry: ForgeIoEntry = {
        address: "",  // Will be assigned below
        tag_name: sig.tag_name,
        signal_type: sig.signal_type,
        data_type: sig.signal_type.startsWith("A") ? "Real" : "Bool",
        description: sig.description,
        module: "",
        slot: 0,
        device_id: device.id,
      };
      
      switch (sig.signal_type) {
        case "DI": diSignals.push(entry); break;
        case "DQ": dqSignals.push(entry); break;
        case "AI": aiSignals.push(entry); break;
        case "AQ": aqSignals.push(entry); break;
      }
    }
  }
  
  // Assign sequential addresses
  // DI: %I0.0, %I0.1, ... %I0.7, %I1.0, %I1.1, ...
  // DQ: %Q0.0, %Q0.1, ...
  // AI: %IW64, %IW66, ...  (word-addressed, starting after digital range)
  // AQ: %QW64, %QW66, ...
  
  let diByte = 0, diBit = 0;
  for (const entry of diSignals) {
    entry.address = `%I${diByte}.${diBit}`;
    diBit++;
    if (diBit > 7) { diBit = 0; diByte++; }
  }
  
  let dqByte = 0, dqBit = 0;
  for (const entry of dqSignals) {
    entry.address = `%Q${dqByte}.${dqBit}`;
    dqBit++;
    if (dqBit > 7) { dqBit = 0; dqByte++; }
  }
  
  // Analog inputs start at word address (typically after digital range)
  // Standard starting address for onboard AI on 1511C is %IW64
  let aiWord = 64;
  for (const entry of aiSignals) {
    entry.address = `%IW${aiWord}`;
    entry.data_type = "Int";  // Raw analog is Int (0-27648), scaled to Real in code
    aiWord += 2;
  }
  
  let aqWord = 64;
  for (const entry of aqSignals) {
    entry.address = `%QW${aqWord}`;
    entry.data_type = "Int";
    aqWord += 2;
  }
  
  setIoList([...diSignals, ...dqSignals, ...aiSignals, ...aqSignals]);
  setIoListKey((k) => k + 1);
}
```

**IMPORTANT:** The above is a simplified sequential assignment. Ideally, use the existing `calculateRackAddresses()` from `src/lib/address-calculator.ts` if the hardware config has modules defined — it knows the correct starting addresses per module/slot. The simple sequential approach is a fallback when no hardware config is set.

Better approach — check if hardware modules are configured:

```typescript
function generateIoListFromDevices() {
  // ... create signal entries as above ...
  
  if (hardware.racks[0]?.modules?.length > 0) {
    // Use the proper address calculator based on configured hardware
    // This assigns addresses based on actual module slot positions
    const addressResult = calculateRackAddresses(hardware.cpu_type, configuredSlots);
    // Map the calculated addresses onto the IO entries
    // ... (use collectAllIoEntries from address-calculator.ts)
  } else {
    // No hardware configured yet — use simple sequential assignment
    // Engineer can re-generate after configuring hardware
    assignSequentialAddresses(diSignals, dqSignals, aiSignals, aqSignals);
  }
}
```

Also add a button label change or note: "Generate IO List from Devices (addresses are sequential — reconfigure after hardware setup for correct module-based addressing)"

---

## Problem 3: Missing DQ outputs in the IO list

If the device type IO defaults or spec analysis didn't include DQ signals for motors and stack lights, the IO list will have no outputs.

### Check:

In `src/lib/device-type-io-defaults.ts`, verify Motor DOL has the CMD output:

```typescript
"Motor DOL": [
  { signal_type: "DQ", suffix: "_CMD", description: "Start command" },    // THIS MUST EXIST
  { signal_type: "DI", suffix: "_RUN", description: "Running feedback" },
  { signal_type: "DI", suffix: "_FLT", description: "Fault" },
],
```

If Motor DOL only has DI entries and no DQ, that's the bug — add the DQ command output.

Also verify Stack Light has DQ outputs:
```typescript
"Stack Light": [
  { signal_type: "DQ", suffix: "_GREEN", description: "Green lamp" },
  { signal_type: "DQ", suffix: "_AMBER", description: "Amber lamp" },
  { signal_type: "DQ", suffix: "_RED", description: "Red lamp" },
],
```

Also check: when the spec analysis extracts devices, does it correctly identify DQ signals? The motor overload (M01_OL) is DI, but the motor command (M01_CMD) is DQ. If the analysis only extracts feedback signals (DI) and misses command outputs (DQ), the IO list will be input-only.

The spec analysis prompt already says "DQ = digital output (coil)" but it may not be extracting command outputs from the spec text. Verify the spec analysis prompt in the app's Prompts page handles this correctly.

---

## Summary of fixes

1. **Recommend Modules**: Subtract onboard CPU IO before suggesting expansion modules. Display onboard vs required vs overflow as a summary.
2. **IO Addresses**: Assign proper sequential %I/%Q addresses when generating IO list from devices. Use the address calculator when hardware modules are configured.
3. **Missing Outputs**: Verify Motor DOL device type defaults include the DQ command output. Verify Stack Light has DQ outputs. Verify spec analysis extracts both DI inputs AND DQ outputs.

## Note on prompts

Any prompt changes suggested here are for the HARDCODED defaults in the codebase. If the user has modified prompts via the in-app Prompts page (stored in Supabase `prompt_sections` table), those take priority and are what the system actually uses. The hardcoded prompts are only fallbacks. Check `resolveSection()` in `src/lib/prompt-defaults.ts` for how this resolution works.

If the spec analysis prompt needs updating, the user may need to update it in the app's Prompts page, not just in the code.

Commit with: "forge-fix: hardware module recommendation + IO address assignment + missing outputs"
