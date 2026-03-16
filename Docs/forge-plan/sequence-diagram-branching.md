The sequence diagram text cleanup is working well. But it still renders ALL steps in a single linear chain — no parallel branches for OR/XOR conditions. This needs to work for ANY project, not just conveyors.

In src/lib/process-sequence-diagram.ts, the buildSequenceDiagram() function needs to detect branching points in the process sequence data and render them as parallel visual paths.

GENERIC DETECTION RULES:

A step is a branching point when ANY of these are true:
1. Its transition has combinator "OR" with 2+ conditions
2. Its actions contain mutually exclusive alternatives (if X do A, if Y do B)
3. Multiple subsequent steps share the same predecessor but act on different devices or signals

GENERIC RENDERING RULES:

When a branch is detected:
1. Insert a decision node (diamond shape) labeled with the combinator: {"XOR"} or {"OR"}
2. Create one visual path per branch, flowing downward in parallel columns
3. Each branch gets UNIQUE step numbers — never reuse the same step number across branches
4. Step numbering scheme: if the split happens at step N, first branch gets N+10, N+20, N+30... second branch gets N+50, N+60, N+70... merge point gets N+80 or next round number
5. Branch labels on the arrows leaving the decision node should be SHORT — the condition that selects that branch (e.g. "PE01 active", "Mode = Auto", "Temp > 80")
6. Each branch step shows its OWN specific action — not a generic description that covers both branches
7. Branches merge back at the first step where both paths converge on the same action
8. If a branch has a fault exit, show it as a red-labeled arrow to a Fault node

WHAT NOT TO DO:
- Do NOT cram both branches into one step node with "if X then A, if Y then B" text
- Do NOT use the same step number for different actions in different branches
- Do NOT make branching specific to conveyors or any single device type — the logic should work for any OR/XOR in any sequence (motor directions, recipe selection, mode switching, etc.)

EXAMPLE — a conveyor with forward/reverse transport would split at the sensor check into two parallel paths: one for forward (different CMD output, different destination sensor) and one for reverse. But the same logic should handle any branching: a recipe selector splitting into different mixing sequences, a mode switch splitting into auto vs manual paths, etc.

The step data comes from the ProcessSequence.steps array in the matrix. If the matrix already has unique step numbers per branch, use them. If it only has sequential numbers, detect the split point and generate branch-specific numbers using the N+10/N+50 scheme above.

Build and test with the single conveyor project as a sanity check, but verify the logic is generic.

Commit with: "forge-ui: generic parallel branch rendering in sequence diagrams for OR/XOR"
