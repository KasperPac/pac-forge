The process flow diagram renderer treats all steps as sequential. The matrix data IS correct — it already has the branch structure, the renderer just doesn't detect it.

THE DATA (from the Conveyor Transfer Sequence):

Step 20: Latch direction
  → OR transition: "PE01_DET = TRUE (run FWD)" OR "PE02_DET = TRUE (run REV)"

Step 30: M01_CMD_FWD = TRUE, M01_CMD_REV = FALSE  ← this is the FORWARD step
Step 40: M01_CMD_REV = TRUE, M01_CMD_FWD = FALSE  ← this is the REVERSE step

Step 50: Monitor (both sensors, both directions, all fault conditions)
  → OR transition: PE02_DET=TRUE OR PE01_DET=TRUE OR PB_STOP OR ESTOP_OK=FALSE OR M01_OL=FALSE

Step 60: Stop (both CMDs OFF)

The renderer currently draws: 20 → 30 → 40 → 50 → 60 (linear)
It should draw: 20 → XOR → (30 | 40) → (50a | 50b) → 60

THE RULE:

When a step has an OR transition with N conditions, check whether the NEXT N steps each correspond to exactly one of those conditions. If yes, those N steps are PARALLEL BRANCHES from the OR step.

Detection algorithm:

```typescript
function detectBranches(steps: ProcessStep[]): BranchInfo | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const transition = step.transition;
    
    // Only OR transitions with 2+ conditions can be branch points
    if (transition.combinator !== "OR" || transition.conditions.length < 2) continue;
    
    const numConditions = transition.conditions.length;
    const candidateBranches = steps.slice(i + 1, i + 1 + numConditions);
    
    // Check if each candidate step matches one condition
    // A step "matches" a condition if:
    //   - Its actions reference devices/signals mentioned in that condition
    //   - Its actions are mutually exclusive with the other candidate steps
    //   - It does NOT reference signals from the other conditions
    
    const matches = transition.conditions.map((cond, condIdx) => {
      const candidateStep = candidateBranches[condIdx];
      if (!candidateStep) return false;
      
      // Extract signal references from the condition and the step
      const condSignals = extractSignals(cond.description);
      const stepSignals = extractSignals(
        candidateStep.actions.map(a => a.description).join(" ")
      );
      
      // The step should reference signals related to this condition
      // and NOT reference signals from other conditions
      const otherCondSignals = transition.conditions
        .filter((_, idx) => idx !== condIdx)
        .flatMap(c => extractSignals(c.description));
      
      const matchesThisCond = condSignals.some(s => 
        stepSignals.some(ss => relatedSignals(s, ss))
      );
      const matchesOtherCond = otherCondSignals.some(s => 
        stepSignals.some(ss => relatedSignals(s, ss))
      );
      
      return matchesThisCond && !matchesOtherCond;
    });
    
    if (matches.every(m => m)) {
      return {
        branchStepIndex: i,
        branchConditions: transition.conditions,
        branchStepRanges: candidateBranches.map((s, idx) => ({
          conditionIndex: idx,
          startStepIndex: i + 1 + idx,
          // Find how far this branch extends before merging
        })),
      };
    }
    
    // FALLBACK: even if steps don't cleanly match conditions 1:1,
    // check for mutual exclusion in the steps themselves.
    // If step 30 sets FWD=TRUE,REV=FALSE and step 40 sets REV=TRUE,FWD=FALSE,
    // they are mutually exclusive regardless of condition matching.
    
    if (candidateBranches.length >= 2) {
      const mutuallyExclusive = areMutuallyExclusive(
        candidateBranches[0], 
        candidateBranches[1]
      );
      if (mutuallyExclusive) {
        return {
          branchStepIndex: i,
          branchConditions: transition.conditions,
          branchStepRanges: [
            { conditionIndex: 0, startStepIndex: i + 1 },
            { conditionIndex: 1, startStepIndex: i + 2 },
          ],
        };
      }
    }
  }
  return null;
}
```

MUTUAL EXCLUSION DETECTION:

Two steps are mutually exclusive when they set the SAME outputs to OPPOSITE values:

```typescript
function areMutuallyExclusive(stepA: ProcessStep, stepB: ProcessStep): boolean {
  const aActions = stepA.actions.map(a => a.description).join(" ");
  const bActions = stepB.actions.map(a => a.description).join(" ");
  
  // Find all "SIGNAL = VALUE" patterns in each step
  const aAssignments = extractAssignments(aActions); // [{signal: "M01_CMD_FWD", value: "TRUE"}, ...]
  const bAssignments = extractAssignments(bActions);
  
  // Check if any signal is set to opposite values
  for (const aAssign of aAssignments) {
    const bAssign = bAssignments.find(b => b.signal === aAssign.signal);
    if (bAssign && bAssign.value !== aAssign.value) {
      return true; // Same signal, different values = mutually exclusive
    }
  }
  return false;
}
```

For the conveyor case:
- Step 30: M01_CMD_FWD = TRUE, M01_CMD_REV = FALSE
- Step 40: M01_CMD_REV = TRUE, M01_CMD_FWD = FALSE
→ M01_CMD_FWD is TRUE in 30, FALSE in 40 → mutually exclusive ✓

BRANCH EXTENT — FINDING THE MERGE POINT:

After detecting branches at steps 30 and 40, find where they merge:

1. The step AFTER the last branch step that references BOTH branches' signals, or
2. The step that doesn't reference any branch-specific signals (it's generic), or
3. The first step where the actions are identical regardless of which branch was taken

For the conveyor: Step 50 monitors both PE01 and PE02 — it references both branches. Step 60 sets both CMDs to FALSE — also generic. So step 50 is the first post-branch step, and it should be SPLIT per branch (forward monitors PE02, reverse monitors PE01).

SPLITTING SHARED STEPS:

Step 50 references both branches — split it:

```typescript
function splitSharedStep(
  step: ProcessStep, 
  branchConditions: TransitionCondition[],
  deviceLinkage: LinkageDevice[],
): ProcessStep[] {
  // For each branch condition, create a copy of the step
  // that only references signals relevant to that branch
  
  return branchConditions.map((cond, idx) => {
    const condSignals = extractSignals(cond.description);
    
    // Filter the step's actions to only those relevant to this branch
    const filteredActions = step.actions.map(action => {
      let desc = action.description;
      
      // If the action lists multiple alternatives separated by OR,
      // keep only the one matching this branch's condition
      const alternatives = desc.split(/\bOR\b/i);
      if (alternatives.length > 1) {
        const matching = alternatives.find(alt => 
          condSignals.some(s => alt.includes(s))
        );
        if (matching) desc = matching.trim();
      }
      
      return { ...action, description: desc };
    });
    
    // Also filter the transition conditions
    const filteredTransition = {
      ...step.transition,
      conditions: step.transition.conditions.filter(c =>
        condSignals.some(s => c.description.includes(s)) ||
        // Keep non-branch-specific conditions (faults, E-stop, etc.)
        !branchConditions.some(bc => 
          extractSignals(bc.description).some(bs => c.description.includes(bs))
        )
      ),
    };
    
    return {
      ...step,
      stepNumber: 0, // will be renumbered
      actions: filteredActions,
      transition: filteredTransition,
    };
  });
}
```

FINAL MERMAID OUTPUT:

After branch detection, splitting, and renumbering:

```mermaid
    %% Steps before branch
    S0["Step 0: Idle\nAll CMDs OFF"]:::step
    S10["Step 10: Check permissives\nESTOP, faults, XOR sensor"]:::step
    S0 --> S10
    
    %% Branch point
    S20["Step 20: Latch direction"]:::step
    S10 --> S20
    S20 --> XOR1{"XOR"}:::decision
    
    %% Forward branch
    XOR1 -->|"PE01 active"| S30["Step 30: CMD_FWD = ON\nCMD_REV = OFF"]:::step
    S30 --> S40["Step 40: Monitor\nWait PE02 detected"]:::monitor
    S40 -->|"PE02 detected"| S50["Step 50: CMD_FWD = OFF"]:::step
    S40 -->|"Fault"| FAULT
    
    %% Reverse branch  
    XOR1 -->|"PE02 active"| S60["Step 60: CMD_REV = ON\nCMD_FWD = OFF"]:::step
    S60 --> S70["Step 70: Monitor\nWait PE01 detected"]:::monitor
    S70 -->|"PE01 detected"| S80["Step 80: CMD_REV = OFF"]:::step
    S70 -->|"Fault"| FAULT
    
    %% Merge
    S50 --> S90["Step 90: Confirm stopped\nM01_RUN = FALSE"]:::step
    S80 --> S90
    S90 --> IDLE(["Idle / Complete"]):::idle
```

STEP RENUMBERING after branch detection:
- Pre-branch steps keep original numbers: 0, 10, 20
- Forward branch: 30, 40, 50 (original step 30 + split monitoring + split stop)
- Reverse branch: 60, 70, 80 (original step 40 + split monitoring + split stop)
- Post-merge: 90+ (original step 60 renumbered)

SUMMARY OF WHAT THE RENDERER MUST DO:

1. Scan steps for OR transitions with 2+ conditions
2. Check if the next N steps are mutually exclusive (same signals, opposite values)
3. If yes → those steps are PARALLEL BRANCHES, not sequential
4. Find the merge point (first step after branches that's generic/shared)
5. Split any shared steps (like the monitoring step) into per-branch copies
6. Renumber all branch steps with unique numbers
7. Generate Mermaid with XOR fork, parallel paths, and merge

The detection is GENERIC — it works by signal analysis (extracting assignments and checking for opposite values), not by looking for specific device names.

Commit with: "forge-fix: detect parallel branches from OR transitions and mutually exclusive steps"
