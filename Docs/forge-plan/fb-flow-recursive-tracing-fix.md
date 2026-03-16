The FB flow diagram parser in src/lib/fb-flow-diagram.ts is only tracing ONE level of assignment. It finds #_SensorDlyOn := #SENSORDLYON and stops. It needs to RECURSIVELY trace backwards through every intermediate variable until it reaches VAR_INPUT variables or constants.

THE PROBLEM:
For #_SensorDlyOn it currently shows:
  #SENSORDLYON → #_SensorDlyOn
  (1 node + output = useless)

IT SHOULD SHOW THE FULL CHAIN:
  #_Sensor = TRUE          #_Forced_Signal = TRUE
       |                        |
  #_Forced_Ctrl = FALSE    #_Forced_Ctrl = TRUE
       |                        |
       +----------+-------------+    ← OR
                  |
             #SensorIn
                  |
       #M002R_P1DlyBlocked
         (IN := #SensorIn, PT := #_BlockedDly)
                  |
         .Q = TRUE
                  |
           #SENSORDLYON
                  |
         #_SensorDlyOn

That's the full signal path from physical input to output.

HOW TO FIX — RECURSIVE BACKWARD TRACING:

The tracing function should work like this:

function traceVariable(varName: string, code: string, visited: Set<string>): TraceNode {
  // Prevent infinite loops on self-referencing variables
  if (visited.has(varName)) return selfHoldNode(varName);
  visited.add(varName);
  
  // If it's a VAR_INPUT, stop — this is a leaf node
  if (isVarInput(varName)) return inputNode(varName);
  
  // Find the assignment: #varName := expression;
  const assignment = findAssignment(varName, code);
  
  // Parse the expression to find what variables it references
  const referencedVars = extractReferencedVariables(assignment.expression);
  
  // Recursively trace each referenced variable
  const children = referencedVars.map(v => traceVariable(v, code, new Set(visited)));
  
  // Detect the logic pattern (AND, OR, timer call, etc.)
  const pattern = detectPattern(assignment.expression);
  
  return {
    variable: varName,
    pattern: pattern,  // "AND", "OR", "TIMER", "EDGE", "ASSIGN", "CASE", etc.
    children: children,
  };
}

KEY PATTERNS TO DETECT IN THE EXPRESSION:

1. Simple assignment: #a := #b; 
   → trace #b, connect directly

2. AND: #a := #b AND #c;
   → trace both, render #b ABOVE #c in series (stacked vertically)

3. OR: #a := #b OR #c;
   → trace both, render #b and #c SIDE BY SIDE (parallel merge)

4. NOT: #a := NOT #b;
   → trace #b, show as "#b = FALSE"

5. Timer: #instTimer(IN := #condition, PT := #duration); then #result := #instTimer.Q;
   → trace #condition, show timer node with PT label, then .Q output
   → IMPORTANT: link the timer call to the .Q read — search for the timer name in both call syntax and .Q access

6. Edge: #instEdge(CLK := #input); then IF #instEdge.Q THEN
   → trace #input, show as edge detection node

7. Combined: #a := (#b OR #c) AND #d;
   → trace #b and #c as OR (side by side), merge, then #d below in AND (series)

8. Self-hold: #latch := (#set OR #latch) AND #hold;
   → detect that #latch appears on BOTH sides of :=
   → trace #set and show self-hold dashed arrow for #latch
   → then AND with #hold in series below

TIMER TRACING IS THE MOST IMPORTANT FIX:

The current parser probably can't link a timer call like:
  #M002R_P1DlyBlocked(IN := #SensorIn, PT := #_BlockedDly);
to a later read like:
  #SENSORDLYON := #M002R_P1DlyBlocked.Q;

It needs to:
1. Find all timer/FB calls in the code: match pattern #instName(IN := ..., PT := ...)
2. Build a map: timerName → { inExpression, ptExpression }
3. When tracing a variable assigned from #timerName.Q, look up the timer's IN expression and trace THAT recursively
4. Show the timer as a node with its PT value as a sublabel

TEST: After fixing, the PE_Sensor "Control Outputs" diagram should show the FULL chain for each output — approximately 6-7 nodes deep per column, not 2.

Build and test with PE_Sensor first. Compare output to the diagrams I showed earlier in this conversation.

Commit with: "forge-fix: recursive backward tracing in FB flow diagram parser"
