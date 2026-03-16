The process flow diagram branching is working — the XOR split produces two parallel columns. Three things are still wrong. ALL fixes must be GENERIC — they must work for any project, not just conveyors. Do not hardcode any device names, signal names, or directions.

PROBLEM 1: DUPLICATE STEP NUMBERS

Both branches reuse the same step numbers from the matrix source data. Each branch MUST have unique step numbers.

The original step numbers from the matrix are SOURCE data. When splitting into branches, the renderer GENERATES new unique numbers. Never reuse matrix step numbers across branches.

Implementation:

```typescript
// After detecting branch point at step index branchIdx:
// Steps before branch keep their original numbers
// Branch steps get renumbered into separate ranges

const preBranchSteps = steps.slice(0, branchIdx);
const branchSteps = steps.slice(branchIdx, mergeIdx);
const postBranchSteps = steps.slice(mergeIdx);

// Highest step number before the branch, rounded up to next 10
const branchBase = Math.ceil((preBranchSteps.at(-1)?.stepNumber ?? 0) / 10 + 1) * 10;

// Branch A: branchBase, branchBase+10, branchBase+20...
branchASteps.forEach((step, i) => {
  step.stepNumber = branchBase + (i * 10);
});

// Branch B: starts 50 above branch A's start
const branchBBase = branchBase + 50;
branchBSteps.forEach((step, i) => {
  step.stepNumber = branchBBase + (i * 10);
});

// Merge point: next round number after both branches
const mergeBase = Math.max(
  branchASteps.at(-1)!.stepNumber,
  branchBSteps.at(-1)!.stepNumber
) + 10;
mergeStep.stepNumber = mergeBase;
```

This works for any number of branches and any source step numbering.

PROBLEM 2: BRANCH ACTIONS ARE GENERIC

Both branches show identical text because the matrix stores both alternatives in a single step. When a step is duplicated into branches, each copy must show ONLY the actions relevant to that branch.

DO NOT use hardcoded signal name replacements (no regex for "FWD"/"REV" or specific device names). Instead, use the MATRIX WIRING DATA to determine which signals belong to which branch.

Generic approach:

```typescript
function resolveBranchActions(
  step: ProcessStep,
  branchCondition: TransitionCondition,  // the condition that selects this branch
  deviceLinkage: LinkageDevice[],
): ProcessStep {
  // 1. Find which devices are referenced in this branch's condition
  const branchDevices = findDevicesInCondition(branchCondition, deviceLinkage);
  
  // 2. Find the wiring entries for those devices
  const branchWiring = deviceLinkage
    .filter(d => branchDevices.includes(d.name) || isDownstreamOf(d, branchDevices, deviceLinkage))
    .flatMap(d => d.wiring);
  
  // 3. From the step's actions, keep only those that reference:
  //    - Devices in this branch's device set
  //    - Outputs that are wired from this branch's devices
  //    - Generic actions that apply to both branches (e.g. "check permissives")
  const filteredActions = step.actions.filter(action => {
    const referencedDevices = extractDeviceReferences(action.description);
    if (referencedDevices.length === 0) return true; // generic action, keep
    return referencedDevices.some(d => branchDevices.includes(d));
  });
  
  // 4. Rewrite action descriptions to be specific
  //    Replace "active CMD output" with the actual output name from wiring
  //    Replace "destination sensor" with the actual sensor name from wiring
  const rewrittenActions = filteredActions.map(action => {
    let desc = action.description;
    
    // Replace generic output references with specific ones from wiring
    branchWiring
      .filter(w => w.direction === "out")
      .forEach(w => {
        desc = desc.replace(/active.*output/gi, `${w.connectedTo} = ON`);
      });
    
    // Replace generic sensor references with specific ones from wiring
    branchWiring
      .filter(w => w.wireType === "fb" && w.direction === "in")
      .forEach(w => {
        desc = desc.replace(/destination.*sensor/gi, w.connectedTo);
      });
    
    return { ...action, description: desc };
  });
  
  return { ...step, actions: rewrittenActions };
}
```

The key principle: the matrix wiring tells you which physical signals belong to which logical path. Use that data — don't parse the text.

If the matrix wiring isn't available or doesn't resolve cleanly, fall back to splitting the action text by detecting mutually exclusive patterns:
- Actions containing "if condition A" go to branch A
- Actions containing "if condition B" go to branch B  
- Actions not containing any condition go to both branches
- If an action references two mutually exclusive outputs, split it: the part matching branch A's condition goes to A, the rest to B

PROBLEM 3: MISSING MONITORING STEPS

Between an "activate output" step and a "deactivate output" step, there should be a monitoring step where the system waits for a completion condition. This is where fault exits originate.

Generic detection: scan each branch for this pattern:
1. A step that sets an output ON
2. Followed by a step that sets the SAME output OFF
3. With NO step in between that waits for a condition

When this pattern is found, INSERT a monitoring step between them:

```typescript
function insertMonitoringSteps(branchSteps: ProcessStep[], branchWiring: FbWire[]): ProcessStep[] {
  const result: ProcessStep[] = [];
  
  for (let i = 0; i < branchSteps.length; i++) {
    result.push(branchSteps[i]);
    
    // Check if this step turns something ON and the next step turns it OFF
    const thisOutputsOn = extractOutputsSetOn(branchSteps[i]);
    const nextOutputsOff = i + 1 < branchSteps.length 
      ? extractOutputsSetOff(branchSteps[i + 1]) 
      : [];
    
    const matchingOutput = thisOutputsOn.find(o => nextOutputsOff.includes(o));
    
    if (matchingOutput) {
      // Find what condition should terminate this step
      // Look in the wiring for completion signals (end sensors, feedback, etc.)
      const completionSignal = findCompletionSignal(matchingOutput, branchWiring);
      
      // Insert monitoring step
      result.push({
        stepNumber: 0, // will be renumbered later
        actions: [{ description: `Monitor: wait for ${completionSignal}` }],
        transition: {
          conditions: [
            { description: `${completionSignal} = TRUE` },
          ],
          combinator: "OR",
        },
        devicesInvolved: branchSteps[i].devicesInvolved,
        notes: "Auto-inserted monitoring step",
      });
    }
  }
  
  return result;
}
```

Finding the completion signal generically: look at the matrix wiring for the device being controlled. FB inputs with names suggesting completion/feedback (containing "endSensor", "feedback", "complete", "done", "arrived", "position", "limit") indicate what the monitoring step should wait for. The wiring entry's connectedTo field gives the actual signal name.

Monitoring steps should also have fault exits. Generically, any step marked as monitoring should get arrows to FAULT for:
- Any timer-based faults defined in the sequence's safety conditions
- E-Stop
- External faults

In Mermaid:
```
S_monitor["Step N: Monitor\nWait for {completionSignal}"]:::monitor
S_monitor -->|"{completionSignal} detected"| S_next
S_monitor -->|"Fault"| FAULT
```

EXPECTED RESULT:

For ANY project, the diagram should show:
- Linear steps before any branching
- XOR/OR diamond where mutually exclusive paths diverge
- Two (or more) parallel columns with UNIQUE step numbers per branch
- Each branch showing SPECIFIC signal names from the matrix wiring (not generic descriptions)
- Monitoring steps between output-ON and output-OFF with fault exits
- Merge point where branches reconverge
- Linear steps after merge

The logic must work for:
- Bi-directional conveyors (forward/reverse)
- Multi-recipe processes (recipe A / recipe B paths)
- Mode-dependent sequences (auto/manual branches)
- Any system where a decision point leads to different device operations

Do NOT hardcode any device names, signal names, sensor names, motor names, or direction labels. All specific text comes from the matrix data.

Commit with: "forge-fix: generic unique step numbers, branch-specific actions from wiring, and monitoring steps"
