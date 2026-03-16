# Restructure: Matrix process sequences as one-condition-per-row table format

## The problem

The current matrix sequence format stores steps as blocks of prose with multiple actions and conditions crammed into one step. The flow diagram renderer has to parse English text to figure out branching, monitoring, and mutual exclusion — and it keeps failing.

The root cause: the data format is ambiguous. A single step can contain conditional logic ("if X do A, if Y do B"), multiple unrelated actions, and transitions that mix completion conditions with fault exits. The renderer can't reliably decompose this.

## The fix

Restructure the sequence data so that every row represents ONE condition, ONE action, and ONE output change. Branching becomes explicit in the data — no text parsing needed.

This affects:
1. The type definition in `src/types/process-builder.ts`
2. The matrix generation prompt (so the PM agent outputs this format)
3. The flow diagram renderer (to consume the new format)
4. The matrix review UI (to display the table)

## New data structure

Replace the current `ProcessStep` with `SequenceRow`:

```typescript
/** Single row in the process sequence table */
export interface SequenceRow {
  /** Step number. Rows sharing the same step number are alternatives (branches) */
  step: number;
  
  /** Sub-ID for branches. "a", "b", "c" etc. Null if no branching at this step */
  branch: string | null;
  
  /** The condition that must be TRUE for this row to execute.
   *  One condition per row. Use actual signal names.
   *  Examples: "PE01_DET = TRUE", "PB_START rising edge", "timeout elapsed" */
  condition: string;
  
  /** What this row does — one action, short imperative.
   *  Examples: "Set motor forward", "Start timeout timer", "Latch fault" */
  action: string;
  
  /** The specific signal change this row produces. Null if no output change.
   *  Examples: "M01_CMD_FWD = TRUE", "FaultData.eStopLatched = TRUE" */
  output: string | null;
  
  /** Which step executes next after this row completes.
   *  Number = go to that step. "FAULT" = enter fault state. "IDLE" = return to idle. */
  next: number | "FAULT" | "IDLE";
  
  /** Row type — determines how the flow diagram renders it */
  type: "action" | "monitor" | "branch" | "fault_exit" | "merge";
  
  /** Devices involved in this row */
  devices: string[];
}

/** Updated process sequence using the table format */
export interface ProcessSequence {
  id: string;
  name: string;
  
  /** Conditions that must remain TRUE throughout the entire sequence.
   *  If any goes FALSE, immediate transition to fault handling. */
  safetyConditions: Array<{
    signal: string;           // "ESTOP_OK", "M01_OL"
    requiredValue: boolean;   // TRUE = must be TRUE, FALSE = must be FALSE
    faultAction: string;      // "Set both CMDs FALSE, latch E-stop fault"
  }>;
  
  /** Conditions checked once before the sequence can start */
  permissives: Array<{
    signal: string;           // "ESTOP_OK", "FaultData.anyFaultLatched"
    requiredValue: boolean;
    description: string;      // "E-stop not pressed", "No faults latched"
  }>;
  
  /** The sequence steps as a flat table. Branching is explicit via step/branch fields */
  rows: SequenceRow[];
}
```

## How branching works in this format

When a step has alternative paths, it gets multiple rows with the SAME step number but DIFFERENT branch IDs and different conditions:

```
step | branch | condition              | action              | output              | next
-----|--------|------------------------|---------------------|---------------------|-----
20   | a      | sensorA = TRUE         | Run actuator fwd    | CMD_FWD = TRUE      | 30
20   | b      | sensorB = TRUE         | Run actuator rev    | CMD_REV = TRUE      | 40
```

Step 20 has two rows — the renderer sees two branches and draws them as parallel paths from a decision node. No text parsing needed.

The `next` field makes the flow explicit:
- Branch "a" goes to step 30
- Branch "b" goes to step 40
- Steps 30 and 40 are in separate branches with their own subsequent steps
- When both branches eventually point `next` to the same step number, that's the merge point

## How monitoring works in this format

A monitoring step is a row with `type: "monitor"` that waits for a condition. Fault exits are separate rows with `type: "fault_exit"` at the same step number:

```
step | branch | condition              | action              | output              | next  | type
-----|--------|------------------------|---------------------|---------------------|-------|------
30   | a      | sensorB = TRUE         | Product arrived     | —                   | 50    | monitor
30   | a      | timeout elapsed        | Timeout fault       | faultLatched = TRUE | FAULT | fault_exit
30   | a      | ESTOP_OK = FALSE       | E-stop triggered    | eStopLatched = TRUE | FAULT | fault_exit
```

The renderer sees: step 30 is a monitor with a success path (→ 50) and two fault exits (→ FAULT). Easy to draw.

## How the flow diagram renderer uses this

The renderer becomes trivially simple:

```typescript
function buildFlowDiagram(sequence: ProcessSequence): string {
  const lines: string[] = ["flowchart TD"];
  
  // 1. Draw safety and permissive nodes (same as before)
  
  // 2. Group rows by step number
  const stepGroups = groupBy(sequence.rows, r => r.step);
  
  // 3. For each step group:
  for (const [stepNum, rows] of stepGroups) {
    const branches = [...new Set(rows.map(r => r.branch).filter(Boolean))];
    
    if (branches.length > 1) {
      // BRANCHING STEP — draw a decision node with one path per branch
      lines.push(`    S${stepNum}_XOR{"XOR"}:::decision`);
      // Connect from previous step
      lines.push(`    ${prevNodeId} --> S${stepNum}_XOR`);
      
      for (const branch of branches) {
        const branchRows = rows.filter(r => r.branch === branch);
        const actionRow = branchRows.find(r => r.type === "action" || r.type === "branch");
        if (actionRow) {
          const nodeId = `S${stepNum}${branch}`;
          lines.push(`    S${stepNum}_XOR -->|"${actionRow.condition}"| ${nodeId}["Step ${stepNum}${branch}: ${actionRow.action}"]:::step`);
        }
      }
    } else {
      // SINGLE STEP — one node
      const actionRows = rows.filter(r => r.type !== "fault_exit");
      const faultRows = rows.filter(r => r.type === "fault_exit");
      
      const mainRow = actionRows[0];
      const nodeId = `S${stepNum}`;
      const nodeClass = mainRow.type === "monitor" ? "monitor" : "step";
      lines.push(`    ${nodeId}["Step ${stepNum}: ${mainRow.action}"]:::${nodeClass}`);
      
      // Connect from previous
      lines.push(`    ${prevNodeId} -->|"${mainRow.condition}"| ${nodeId}`);
      
      // Add fault exits
      for (const fault of faultRows) {
        lines.push(`    ${nodeId} -->|"${fault.condition}"| FAULT`);
      }
    }
  }
  
  // 4. Detect merge points — any step number that appears as `next` in multiple branches
  // Draw merge connections
  
  return lines.join("\n");
}
```

The key: no text parsing, no mutual exclusion detection, no prose analysis. The data tells the renderer exactly what to draw.

## Update the matrix generation prompt

The PM agent that generates the matrix needs an updated prompt to output the new format. Add this to the matrix generation system prompt (in the Supabase edge function or the prompts table):

```
When generating process sequences, output each step as table rows with these columns:
- step: Step number (integer, multiples of 10)
- branch: Sub-ID for alternatives at the same step ("a", "b", "c" or null if no branching)
- condition: The ONE condition for this row to execute. Use actual signal names.
- action: ONE action this row performs. Short imperative phrase.
- output: The specific signal change, or null. Use "SIGNAL = VALUE" format.
- next: The step number to go to next, or "FAULT" or "IDLE"
- type: "action", "monitor", "branch", "fault_exit", or "merge"
- devices: Array of device names involved

RULES:
1. ONE condition per row. Never combine conditions with AND/OR in a single row.
   WRONG: "PE01_DET = TRUE AND ESTOP_OK = TRUE AND no faults"
   RIGHT: Three separate rows at the same step, or put the AND conditions in permissives.

2. ONE action per row. Never combine multiple operations.
   WRONG: "Set M01_CMD_FWD = TRUE, M01_CMD_REV = FALSE, start timer"
   RIGHT: Three rows — one for CMD_FWD, one for CMD_REV, one for the timer.

3. Branching is EXPLICIT. When a step has mutually exclusive alternatives, give each alternative its own row with a different branch ID and different condition.
   WRONG: Step 2: "If direction forward: CMD_FWD = TRUE; if direction reverse: CMD_REV = TRUE"
   RIGHT: Step 20a: condition="directionFwd = TRUE", output="CMD_FWD = TRUE", next=30
           Step 20b: condition="directionRev = TRUE", output="CMD_REV = TRUE", next=40

4. Monitoring steps have type "monitor". They wait for a completion condition.
   Fault exits from monitoring steps are SEPARATE rows with type "fault_exit" at the same step number.

5. The "next" field makes flow explicit. No ambiguity about what follows what.
   Branch merges happen when two branches' "next" fields point to the same step number.

6. Use actual signal names throughout — device instance names, IO tag names, DB field names.
   No prose descriptions like "motor runs" — use "M01_CMD_FWD = TRUE".

7. Step numbers should be multiples of 10 (0, 10, 20, 30...) to leave room for inserted steps.
   Branch sub-steps use the same number with letter suffix in the branch field.
```

## Example output for ANY bi-directional transport system

This is an EXAMPLE showing the pattern. The actual signal names, step counts, and device names will vary per project.

```json
{
  "rows": [
    {"step": 0,  "branch": null, "condition": "Power on",              "action": "All outputs OFF",           "output": null,              "next": 10, "type": "action",     "devices": []},
    {"step": 10, "branch": null, "condition": "Start button pressed",  "action": "Check permissives",         "output": null,              "next": 20, "type": "action",     "devices": ["PB_START"]},
    {"step": 20, "branch": "a",  "condition": "sensorA = TRUE",        "action": "Run actuator forward",      "output": "CMD_FWD = TRUE",  "next": 30, "type": "branch",     "devices": ["SENSOR_A", "ACTUATOR"]},
    {"step": 20, "branch": "b",  "condition": "sensorB = TRUE",        "action": "Run actuator reverse",      "output": "CMD_REV = TRUE",  "next": 40, "type": "branch",     "devices": ["SENSOR_B", "ACTUATOR"]},
    {"step": 30, "branch": "a",  "condition": "sensorB = TRUE",        "action": "Product arrived at B",      "output": null,              "next": 50, "type": "monitor",    "devices": ["SENSOR_B"]},
    {"step": 30, "branch": "a",  "condition": "timeout elapsed",       "action": "Timeout fault",             "output": "faultLatched",    "next": "FAULT", "type": "fault_exit", "devices": []},
    {"step": 40, "branch": "b",  "condition": "sensorA = TRUE",        "action": "Product arrived at A",      "output": null,              "next": 50, "type": "monitor",    "devices": ["SENSOR_A"]},
    {"step": 40, "branch": "b",  "condition": "timeout elapsed",       "action": "Timeout fault",             "output": "faultLatched",    "next": "FAULT", "type": "fault_exit", "devices": []},
    {"step": 50, "branch": null, "condition": "output confirmed OFF",  "action": "Actuator stopped",          "output": "CMD_FWD = FALSE", "next": 0,  "type": "merge",      "devices": ["ACTUATOR"]}
  ]
}
```

The renderer reads this table and draws:
- Steps 0 and 10: linear (no branching)
- Step 20: XOR decision node — two rows with branch "a" and "b"
- Step 30 (branch a): monitor with fault exit
- Step 40 (branch b): monitor with fault exit
- Step 50: merge point (both branches' next = 50)
- Back to step 0

No text parsing. No mutual exclusion detection. No guessing. The data says exactly what to draw.

## Migration

Keep the old `ProcessStep` type for backward compatibility with existing saved sessions. Add a migration function:

```typescript
function migrateStepsToRows(steps: ProcessStep[]): SequenceRow[] {
  // Convert old format to new format
  // This is a best-effort conversion for existing data
  // New matrix generations will use the row format directly
}
```

The renderer should check which format the data is in and use the appropriate path:
- If `sequence.rows` exists → use new table renderer
- If `sequence.steps` exists → use old renderer (or migrate on the fly)

## Implementation order

1. Add `SequenceRow` type to `src/types/process-builder.ts`
2. Update the matrix generation prompt to output the new format
3. Rewrite the flow diagram renderer to consume `SequenceRow[]`
4. Update the matrix review UI to display the table
5. Add migration function for old sessions
6. Test with multiple project types

## Testing

Test with projects that have:
- Linear sequences (no branching) — should render as a straight chain
- Binary branching (two alternatives) — should render as XOR split with two columns
- Multi-way branching (3+ alternatives, e.g. recipe selection) — should render as decision with N paths
- Nested branching (branch within a branch) — should handle gracefully
- No monitoring steps (instant actions) — should skip monitor nodes
- Multiple fault exits from one monitoring step — each gets its own arrow to FAULT

The format is generic — it works for any process, any number of devices, any branching pattern.

Commit with: "forge-arch: restructure process sequences as one-condition-per-row table format"
