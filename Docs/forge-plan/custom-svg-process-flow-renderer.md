# Replace Mermaid with custom SVG renderer for process flow diagrams

## Why

Mermaid's auto-layout engine keeps breaking the process flow diagram. It scatters nodes sideways, orphans steps that should be connected, and doesn't handle branch-merge patterns reliably. We've tried fixing the data multiple times — the data is now correct, but Mermaid still can't render it properly.

Replace the Mermaid renderer with a custom SVG renderer that reads the `SequenceRow[]` data and produces a clean, predictable diagram with controlled positioning.

## What to replace

In `src/lib/process-sequence-diagram.ts`, replace the function that generates Mermaid syntax with a function that generates SVG directly.

In `src/components/forge/steps/forge-matrix-review.tsx`, replace the `<MermaidDiagram>` component with a new `<ProcessFlowSvg>` component that renders the SVG.

Keep the Mermaid component and its imports — they may be used elsewhere. Just stop using them for process flow.

## Layout rules

The layout is NOT algorithmic. It follows a fixed template. Process flows are vertical, top to bottom, with controlled horizontal splits for branches.

### Coordinate system
- SVG viewBox width: 800 (wider than 680 to accommodate branches)
- Content area: x=40 to x=760
- Center column: x=400
- Left branch column: x=200
- Right branch column: x=600
- Vertical spacing between steps: 80px
- Node width: 260px (single column), 220px (branch columns)
- Node height: 50px (single line), 70px (two lines)
- Connection type: right-angle only, no curves, no diagonals

### Step rendering

Each step is rendered based on its `type` field:

**action** — Rectangle with rounded corners (rx=8). Teal fill.
```
┌─────────────────────────┐
│ Step 40: Update state    │
│ SystemState.state = 1    │
└─────────────────────────┘
```

**monitor** — Rectangle with rounded corners (rx=8). Purple fill.
```
┌─────────────────────────┐
│ Step 50: Wait M01_RUN    │
│ Run feedback confirmed   │
└─────────────────────────┘
```

**branch** — Rectangle with rounded corners (rx=8). Teal fill. Placed in left or right column.
```
┌───────────────┐   ┌───────────────┐
│ Step 30a:      │   │ Step 30b:      │
│ CMD_FWD = TRUE │   │ CMD_REV = TRUE │
└───────────────┘   └───────────────┘
```

**fault_exit** — Small rectangle with red fill. Arrow goes to FAULT node.
```
Step 50 ──── fault_exit ──→ ⚠ FAULT
```

**merge** — No visible node. Just the point where branch connections rejoin the center column.

### Connection rendering

ALL connections are right-angle paths:

**Vertical (normal flow):**
```svg
<line x1="400" y1="{y1}" x2="400" y2="{y2}" class="arr" marker-end="url(#arrow)"/>
```

**Branch split (center to left and right):**
```svg
<!-- Center down to split point -->
<line x1="400" y1="{y1}" x2="400" y2="{splitY}" class="arr"/>
<!-- Left branch -->
<line x1="400" y1="{splitY}" x2="200" y2="{splitY}" class="arr"/>
<line x1="200" y1="{splitY}" x2="200" y2="{y2}" class="arr" marker-end="url(#arrow)"/>
<!-- Right branch -->
<line x1="400" y1="{splitY}" x2="600" y2="{splitY}" class="arr"/>
<line x1="600" y1="{splitY}" x2="600" y2="{y2}" class="arr" marker-end="url(#arrow)"/>
```

**Branch merge (left and right back to center):**
```svg
<!-- Left branch down to merge Y -->
<line x1="200" y1="{y1}" x2="200" y2="{mergeY}" class="arr"/>
<line x1="200" y1="{mergeY}" x2="400" y2="{mergeY}" class="arr"/>
<!-- Right branch down to merge Y -->
<line x1="600" y1="{y1}" x2="600" y2="{mergeY}" class="arr"/>
<line x1="600" y1="{mergeY}" x2="400" y2="{mergeY}" class="arr"/>
<!-- Center continues down -->
<line x1="400" y1="{mergeY}" x2="400" y2="{y2}" class="arr" marker-end="url(#arrow)"/>
```

**Fault exit (side arrow from a step):**
```svg
<line x1="{nodeRight}" y1="{nodeMiddleY}" x2="{faultX}" y2="{nodeMiddleY}" stroke="#E24B4A" stroke-width="1.5" marker-end="url(#arrow)"/>
```

### XOR decision diamond

When branches are detected, draw a small diamond at the split point:
```svg
<polygon points="{cx},{cy-16} {cx+16},{cy} {cx},{cy+16} {cx-16},{cy}" fill="none" stroke="var(--color-border-secondary)" stroke-width="0.5"/>
<text x="{cx}" y="{cy}" text-anchor="middle" dominant-baseline="central" class="ts">XOR</text>
```

Branch labels go on the horizontal arms leaving the diamond.

## Rendering algorithm

```typescript
interface ProcessFlowSvgProps {
  sequence: ProcessSequence;
  className?: string;
}

function renderProcessFlowSvg(sequence: ProcessSequence): string {
  const rows = sequence.rows;
  let y = 40; // starting Y position
  let currentColumn = "center"; // "center" | "branched"
  const svgElements: string[] = [];
  const nodePositions: Map<string, {x: number, y: number, width: number, height: number}> = new Map();
  
  // Phase 1: Calculate positions
  // Group rows by step number
  const stepGroups = groupRowsByStep(rows);
  
  for (const [stepNum, stepRows] of stepGroups) {
    const branches = getUniqueBranches(stepRows);
    const actionRows = stepRows.filter(r => r.type !== "fault_exit");
    const faultRows = stepRows.filter(r => r.type === "fault_exit");
    
    if (branches.length > 1) {
      // BRANCHING STEP
      // Draw XOR diamond at current Y
      // Place branch "a" in left column, branch "b" in right column
      // Advance Y by nodeHeight + spacing
      
      const diamondY = y;
      y += 40; // space for diamond
      
      for (let i = 0; i < branches.length; i++) {
        const branchRow = actionRows.find(r => r.branch === branches[i]);
        const nodeX = i === 0 ? 200 : 600; // left or right
        const nodeId = `S${stepNum}${branches[i]}`;
        nodePositions.set(nodeId, { x: nodeX, y, width: 220, height: 50 });
      }
      
      y += 50 + 30; // node height + gap
      currentColumn = "branched";
      
    } else if (currentColumn === "branched" && branches.length <= 1) {
      // MERGE POINT — branches rejoin center
      // Draw merge connections from left and right to center
      // Then place this step in center column
      
      currentColumn = "center";
      const nodeId = `S${stepNum}`;
      nodePositions.set(nodeId, { x: 400, y, width: 260, height: 50 });
      y += 50 + 30;
      
    } else {
      // LINEAR STEP — single node in center column
      const nodeId = `S${stepNum}`;
      const mainRow = actionRows[0];
      const height = mainRow && mainRow.output ? 70 : 50;
      nodePositions.set(nodeId, { x: 400, y, width: 260, height });
      y += height + 30;
    }
    
    // Fault exits: position to the right of the step
    for (const faultRow of faultRows) {
      // Don't advance Y — fault exits sit beside their parent step
    }
  }
  
  // Phase 2: Render SVG elements
  // ... render nodes, connections, labels, fault exits
  
  return buildSvgString(svgElements, y + 40);
}
```

## Node styles (dark mode)

Use inline styles or CSS classes. These colors match the existing app theme:

```typescript
const STYLES = {
  action: { fill: "#0a3d35", stroke: "#1D9E75", textFill: "#E1F5EE" },
  monitor: { fill: "#2a2150", stroke: "#7F77DD", textFill: "#EEEDFE" },
  branch: { fill: "#0a3d35", stroke: "#1D9E75", textFill: "#E1F5EE" },
  fault_exit: { fill: "#3a1515", stroke: "#E24B4A", textFill: "#FCEBEB" },
  fault_node: { fill: "#791F1F", stroke: "#F09595", textFill: "#FCEBEB" },
  idle: { fill: "#2C2C2A", stroke: "#888780", textFill: "#F1EFE8" },
  decision: { fill: "none", stroke: "#888780", textFill: "#F1EFE8" },
  safety: { fill: "#3C3489", stroke: "#AFA9EC", textFill: "#EEEDFE" },
  permissive: { fill: "#3C3489", stroke: "#AFA9EC", textFill: "#EEEDFE" },
  input: { fill: "#0C447C", stroke: "#85B7EB", textFill: "#E6F1FB" },
  output: { fill: "#3B6D11", stroke: "#97C459", textFill: "#EAF3DE" },
  db: { fill: "#2C2C2A", stroke: "#888780", textFill: "#F1EFE8" },
  fb: { fill: "#085041", stroke: "#5DCAA5", textFill: "#E1F5EE" },
};
```

## Text truncation

All node text must fit within the node width:
- Title: "Step {N}: {short action}" — max 30 chars. Font 14px bold.
- Subtitle (output): "{signal} = {value}" — max 35 chars. Font 12px.
- If text exceeds max, truncate with "..."
- Transition labels on arrows: max 20 chars. Font 12px.

## Sections of the diagram

The full diagram includes these sections in order, each rendered as a vertical block:

### 1. Physical inputs and FB instances (top)
- Row of input tag boxes (blue)
- Arrow down to Inputs DB bar (gray)
- Row of FB instance boxes (teal) with key outputs listed

### 2. Safety and permissive nodes (after FBs)
- Safety hexagon with condition list
- Permissive hexagon with condition list
- Fail arrow to FAULT node

### 3. Process steps (main body)
- Linear steps in center column
- Branch steps split to left/right columns
- Monitor steps in purple
- Fault exits as red arrows to FAULT
- Merge points rejoin center

### 4. Output path (after steps)
- Output FB boxes
- Outputs DB bar
- Physical output tag boxes (green)

### 5. Stop/fault handling (bottom or side)
- E-stop node (red)
- Normal stop node (coral)
- Fault reset node (coral)

### 6. FAULT node
- Single red hexagon, positioned to the right of the main flow
- All fault_exit arrows point to it

## Integration

```typescript
// In forge-matrix-review.tsx, replace:
const diagramChart = buildProcessFlowDiagram(activeSeq, context);
<MermaidDiagram chart={diagramChart} />

// With:
const svgContent = renderProcessFlowSvg(activeSeq, context);
<div dangerouslySetInnerHTML={{ __html: svgContent }} />

// Or better, create a React component:
<ProcessFlowSvg sequence={activeSeq} context={context} />
```

## What NOT to do

- Do NOT use any layout library (dagre, d3-hierarchy, etc). Positions are calculated directly.
- Do NOT use Mermaid anywhere in this renderer.
- Do NOT try to make a generic graph layout algorithm. This is a fixed template with controlled positions.
- Do NOT skip steps. Every row in the table must produce either a visible node or a connection. If a step appears in the table but not in the diagram, it's a bug.

## Validation

After rendering, verify:
1. Every step number in the table has a corresponding node in the SVG
2. Every `next` pointer produces a visible connection arrow
3. Every fault_exit row produces a red arrow to the FAULT node
4. No nodes overlap
5. No connections cross through nodes
6. The flow reads top-to-bottom with no upward arrows (except back to idle at the end)

## Test

Render the current EFD-003 Conveyor Transfer Sequence. It has 12 rows:

```
0  → 10 (linear)
10 → 20 (with fault_exit to 0)
20 → 30 (with fault_exit to 0)
30a → 40 (branch: CMD_FWD)   ← LEFT COLUMN
30b → 40 (branch: CMD_REV)   ← RIGHT COLUMN
40 → 50 (merge, linear)
50 → 60 (with fault_exit to FAULT)
60 → 70 (with fault_exits for E-stop, overload → FAULT, plus PB_STOP monitor)
70 → 80 (with fault_exit to FAULT)
80 → 90 (linear)
90 → 0 (back to idle)
```

The resulting diagram should show:
- Steps 0, 10, 20 in center column (linear)
- XOR diamond after step 20
- Step 30a in left column, 30b in right column
- Merge at step 40 back to center
- Steps 40-90 in center column (linear)
- Fault exits as red arrows to a FAULT node on the right
- Back-to-idle arrow from step 90 to step 0

Every step visible. Every connection drawn. No orphans.

Commit with: "forge-ui: replace Mermaid with custom SVG renderer for process flow diagrams"
