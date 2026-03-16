Bug fix: Hardware/IO step shows empty devices and IO list even after spec analysis.

The problem is in src/components/forge/steps/forge-hardware-io.tsx. The devices, ioList, and hardware state are initialized from specAnalysis via useState, but useState only reads its initial value on FIRST MOUNT. If session.spec_analysis hasn't loaded yet (React Query still fetching), the initial state is empty and never updates.

Fix: Add a useEffect that populates the state when specAnalysis changes from null/undefined to a real value:

```typescript
useEffect(() => {
  if (!specAnalysis) return;
  
  // Only populate if the lists are still empty (don't overwrite user edits)
  setDevices((prev) => {
    if (prev.length > 0) return prev;
    const raw = devicesFromAnalysis(specAnalysis);
    const matches = matchDevicesToTemplates(raw, fbTemplates);
    return applyMatchesToDevices(raw, matches);
  });
  
  setIoList((prev) => {
    if (prev.length > 0) return prev;
    return ioFromAnalysis(specAnalysis);
  });
  
  setHardware((prev) => {
    if (prev.cpu_type !== "S7-1500" || prev.racks[0]?.modules?.length > 0) return prev;
    return { ...prev, cpu_type: specAnalysis.plc_type || prev.cpu_type };
  });
}, [specAnalysis, fbTemplates]);
```

This ensures:
- Empty state gets populated when spec analysis data arrives
- If the engineer has already manually added devices or IO, their edits are NOT overwritten
- The effect re-runs if fbTemplates load late (template matching needs them)

Also check: in src/routes/forge.tsx, verify that session.spec_analysis is not null when hardware_io step renders. Add a guard in the route if missing:

```typescript
case "hardware_io":
  // Don't render until session data is loaded
  if (!session) return null;
  return (
    <ForgeHardwareIo
      specAnalysis={session.spec_analysis}
      ...
```

Commit with: "forge-fix: populate hardware/IO step from spec analysis data"
