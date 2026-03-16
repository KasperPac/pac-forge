The process flow diagram is NOT branching. It renders all steps in a single linear chain even when the logic requires parallel paths. This is the critical bug.

WHAT IT'S DOING WRONG:

Step 3 shows "M01_CMD_FWD = ON, M01_CMD_REV = ON" — both ON at the same time. This is a mutual exclusion violation. FWD and REV can never both be ON.

The direction diamond appears AFTER the CMD is set. It should appear BEFORE — you decide direction first, then issue the correct CMD.

There are no parallel branches. The entire sequence is one linear chain.

WHAT IT SHOULD DO:

The XOR/OR split must happen BEFORE the motor command steps. After the split, each branch has its OWN steps with UNIQUE step numbers doing DIFFERENT things:

```
Permissives OK
    |
Step 10: Start command (PB_START.shortPress)
    |
   XOR  ← this is where it splits
   / \
PE01    PE02
  |       |
Step 20: Set direction FWD     Step 70: Set direction REV
  |                              |
Step 30: CMD_FWD = ON           Step 80: CMD_REV = ON
  |                              |
Step 40: Monitor (wait PE02)    Step 90: Monitor (wait PE01)
  |                              |
Step 50: CMD_FWD = OFF          Step 100: CMD_REV = OFF
  \                             /
   \                           /
    Step 110: Confirm stopped
         |
    Idle / Complete
```

Left branch: forward — different CMD output, different destination sensor
Right branch: reverse — different CMD output, different destination sensor
Each branch has UNIQUE step numbers. They NEVER share a step.

HOW TO FIX in src/lib/process-sequence-diagram.ts:

The problem is in how the steps array is processed. The matrix stores the sequence as linear steps where a single step may contain actions for BOTH directions (e.g. "If direction Fwd = ON set M01_CMD_FWD, if direction Fwd = OFF set M01_CMD_REV"). The renderer needs to DETECT this and SPLIT it.

STEP 1 — DETECT BRANCH POINTS:

Before rendering, scan all steps. A step is a branch point when ANY of:

a) Its actions contain BOTH "FWD" and "REV" (or both "forward" and "reverse") — case insensitive
b) Its actions contain "if direction" or "if.*fwd.*rev" logic
c) Its transition has combinator "OR" with 2+ conditions that reference different sensors or devices
d) Its actions reference mutually exclusive outputs (CMD_FWD and CMD_REV, or any two outputs that share a mutual exclusion rule from the safety conditions)

This detection must be GENERIC — don't hardcode "FWD"/"REV". Look for patterns:
- Two different device instances of the same type being acted on differently
- Conditional logic within a single step's actions (if/else, direction-dependent)
- OR transitions that lead to different device operations

STEP 2 — SPLIT THE BRANCH POINT:

When a branch point is detected at step index I:

a) Find the branch condition — this comes from the step's transition conditions, or from the IF/ELSE within its actions
b) Find the merge point — scan forward from step I to find the first step where both branches converge (same action regardless of direction, like "confirm stopped" or "return to idle")
c) All steps between the branch point and merge point get DUPLICATED into two paths
d) Each path gets unique step numbers:
   - Branch A: base + 10, base + 20, base + 30, base + 40
   - Branch B: base + 50, base + 60, base + 70, base + 75
   - Merge: base + 80

STEP 3 — CLEAN UP BRANCH ACTIONS:

For each duplicated step, strip out the actions that belong to the OTHER branch:

Branch A (e.g. forward):
- Keep only actions referencing FWD, forward, the forward sensor
- Remove any "if direction = reverse" actions
- Replace generic descriptions with specific: "CMD_FWD = ON" not "CMD_FWD = ON, CMD_REV = ON"

Branch B (e.g. reverse):
- Keep only actions referencing REV, reverse, the reverse sensor
- Remove any "if direction = forward" actions
- Replace generic descriptions with specific: "CMD_REV = ON" not "CMD_FWD = ON, CMD_REV = ON"

STEP 4 — GENERATE MERMAID WITH PARALLEL BRANCHES:

```
    S10["Step 10: Start command"] --> XOR1{"XOR"}
    XOR1 -->|"PE01 active"| S20["Step 20: Direction = fwd"]
    XOR1 -->|"PE02 active"| S70["Step 70: Direction = rev"]
    
    S20 --> S30["Step 30: CMD_FWD = ON"]
    S30 --> S40["Step 40: Monitor - wait PE02"]
    S40 -->|"PE02 detected"| S50["Step 50: CMD_FWD = OFF"]
    S40 -->|"Fault"| FAULT
    
    S70 --> S80["Step 80: CMD_REV = ON"]
    S80 --> S90["Step 90: Monitor - wait PE01"]
    S90 -->|"PE01 detected"| S100["Step 100: CMD_REV = OFF"]
    S90 -->|"Fault"| FAULT
    
    S50 --> S110["Step 110: Confirm stopped"]
    S100 --> S110
    S110 --> IDLE
```

IMPORTANT: Mermaid flowchart TD handles the side-by-side layout automatically when two branches fork from the same node. You don't need to position anything — just generate the correct node connections and Mermaid will lay out the parallel columns.

STEP 5 — VERIFY MUTUAL EXCLUSION:

After generating the Mermaid, scan the output. If ANY step node text contains BOTH "FWD = ON" and "REV = ON" (or equivalent), the branching failed. Log a warning and retry the split.

No step should ever reference both directions being active simultaneously.

TEST:

Run with the EFD-003 single conveyor project. The output should show:
- Steps before the split: linear chain (idle → start → permissives)
- XOR diamond node
- Two parallel paths with different step numbers (20-50 left, 70-100 right)
- Different CMD outputs per path (FWD only on left, REV only on right)
- Different monitoring sensors per path (PE02 on left, PE01 on right)
- Merge at confirm stopped step
- Steps after merge: linear chain to idle

If the branches still don't appear, check whether Mermaid is collapsing them. Try adding invisible spacer nodes or subgraphs to force the parallel layout:

```
    subgraph forward["Forward path"]
        S20 --> S30 --> S40 --> S50
    end
    subgraph reverse["Reverse path"]
        S70 --> S80 --> S90 --> S100
    end
```

Commit with: "forge-fix: split direction-dependent steps into parallel branches in process flow diagram"
