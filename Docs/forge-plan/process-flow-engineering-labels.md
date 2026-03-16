The process flow diagram structure is correct — branching, connections, and step order are all working. Two fixes needed: readability and engineering-focused labels.

## FIX 1: NODE TEXT — ENGINEERING FIRST, PROSE SECOND

Current nodes show natural language like "Set motor forward — conveyor runs towards End B". Engineers want to see signal names, not descriptions.

Each node should have 3 lines:

LINE 1 (bold, 14px): Step number + condition signal
LINE 2 (small, 11px, muted): Plain English context
LINE 3 (bold, 13px, bright): Output signal assignment

EXAMPLE — current:
```
┌──────────────────────────────────────┐
│ 30a: Set motor forwar...             │
│ InstM01.cmdFwd = TRUE                │
└──────────────────────────────────────┘
```

EXAMPLE — wanted:
```
┌──────────────────────────────────────┐
│ 30a: PE01_DET = TRUE                 │  ← condition signal (bold)
│ Product at End A                     │  ← context (small, muted)
│ InstM01.cmdFwd = TRUE                │  ← output (bold, green-tinted)
└──────────────────────────────────────┘
```

For monitor steps:
```
┌──────────────────────────────────────┐
│ 40: InstM01.running = TRUE           │  ← condition signal
│ Run feedback confirmed               │  ← context
│ HmiData.systemState = 1              │  ← output
└──────────────────────────────────────┘
```

For fault_exit arrows, the label should show the signal:
```
Step 40 ──── runFeedbackTimeout elapsed ──→ ⚠ FAULT
```

Not:
```
Step 40 ──── runFeedbackTimeout (f... ──→ ⚠ FAULT
```

The data is already in the SequenceRow — condition field has the signal, action field has the prose, output field has the output signal. Just map them to the three lines.

## FIX 2: NODE SIZING — TEXT MUST FIT

Current nodes are truncating text with "..." everywhere because the nodes are too small.

Rules:
- Node width: 280px minimum for center column, 240px for branch columns
- Node height: 80px for 3-line nodes, 60px for 2-line nodes
- Text padding: 12px on each side
- Max chars per line: calculate from node width. At 14px font, roughly 7.5px per char. For 280px node with 24px padding = 256px usable = ~34 chars max for line 1. At 11px font = ~6px per char = ~42 chars for line 2.
- If text still exceeds max after sizing, truncate the CONTEXT line (line 2) first — never truncate the signal names (lines 1 and 3)
- Fault exit labels: allow up to 200px width for the label text on the arrow

## FIX 3: TRANSITION LABELS ON ARROWS

The labels between steps (on the arrows) are also truncated. These should show the key signal transition, not the step's full condition.

Keep transition labels SHORT — just the signal check:
- "PE01_DET = TRUE" not "PE01_DET = TRUE OR PE02_DET = TRUE (but not both)"
- "PB_START ↑" not "PB_START rising edge detected"  
- "M01_RUN = TRUE" not "InstM01.running = TRUE (M01_RUN feedback confirmed)"
- "Any permissive fails..." not the full permissive list

Max 25 chars on transition labels. Truncate the PROSE part, keep the SIGNAL part.

## FIX 4: COLOURS FOR OUTPUT TEXT

Line 3 (the output signal) should use a slightly different colour to distinguish it from the condition:
- Condition (line 1): white/primary text
- Context (line 2): muted/secondary text  
- Output (line 3): teal or green-tinted text (same as the output node colour family)

This creates a visual pattern: white = what triggers this step, gray = why, green = what it does.

## SUMMARY

The node template:
```svg
<rect x="{x}" y="{y}" width="{w}" height="80" rx="8" fill="{fillColor}" stroke="{strokeColor}" stroke-width="0.5"/>
<text x="{cx}" y="{y+20}" text-anchor="middle" fill="#E8E8E8" font-size="14" font-weight="500">{stepNum}: {condition signal}</text>
<text x="{cx}" y="{y+38}" text-anchor="middle" fill="#888" font-size="11">{action description}</text>
<text x="{cx}" y="{y+56}" text-anchor="middle" fill="#5DCAA5" font-size="13" font-weight="500">{output signal}</text>
```

If there's no output (output = "–"), make the node 60px tall and skip line 3.

Build and test with the EFD-003 sequence. Every signal name should be fully visible — no truncation on lines 1 and 3.

Commit with: "forge-ui: engineering-focused node labels with signal names prominent"
