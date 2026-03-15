// fb-flow-diagram.ts
// Parses SCL Function Block code and generates signal flow diagram data.
// Focuses on patterns that appear in standard motor/conveyor FBs.

export interface FbFlowDiagram {
  title: string;
  columns: FbFlowColumn[];
}

export interface FbFlowColumn {
  outputName: string;
  nodes: FbFlowNode[];
  connections: FbFlowConnection[];
}

export interface FbFlowNode {
  id: string;
  type: "input" | "condition" | "timer" | "intermediate" | "output" | "fault";
  label: string;
  sublabel?: string;
  shape: "rect" | "pill" | "hexagon";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FbFlowConnection {
  fromId: string;
  toId: string;
  type: "normal" | "fault" | "selfhold" | "reset";
  label?: string;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const COL_WIDTH = 180;
const COL_GAP = 32;
const NODE_HEIGHT = 38;
const NODE_WIDTH = 160;
const V_GAP = 28;
const OUTPUT_HEIGHT = 44;
const DIAGRAM_PADDING = 32;

// ---------------------------------------------------------------------------
// Internal types used during parsing
// ---------------------------------------------------------------------------

type VarKind = "input" | "output" | "static" | "temp";

interface VarDecl {
  name: string;
  type: string;
  kind: VarKind;
}

type ExprNode =
  | { kind: "var"; name: string }
  | { kind: "not"; child: ExprNode }
  | { kind: "and"; left: ExprNode; right: ExprNode }
  | { kind: "or"; left: ExprNode; right: ExprNode }
  | { kind: "compare"; lhs: string; op: string; rhs: string }
  | { kind: "timer_q"; timerName: string }
  | { kind: "edge_q"; edgeName: string }
  | { kind: "literal"; value: string };

interface TimerCall {
  timerName: string;
  inCondition: string | null;
}

interface EdgeCall {
  edgeName: string;
  clkCondition: string | null;
}

interface Assignment {
  lhs: string; // variable name (without #)
  rhs: string; // raw RHS string
}

interface FaultLatch {
  latchName: string;
  condition: string;
  isSet: boolean; // TRUE = set latch, FALSE = reset latch
}

// ---------------------------------------------------------------------------
// Step 1 — Parse VAR sections
// ---------------------------------------------------------------------------

function parseVarSections(scl: string): VarDecl[] {
  const decls: VarDecl[] = [];

  // Match VAR_INPUT, VAR_OUTPUT, VAR (static), VAR_TEMP blocks
  const sectionRe =
    /\b(VAR_INPUT|VAR_OUTPUT|VAR_TEMP|VAR)\b([\s\S]*?)END_VAR/g;
  let sm: RegExpExecArray | null;

  while ((sm = sectionRe.exec(scl)) !== null) {
    const rawKind = sm[1];
    const body = sm[2];

    const kind: VarKind =
      rawKind === "VAR_INPUT"
        ? "input"
        : rawKind === "VAR_OUTPUT"
          ? "output"
          : rawKind === "VAR_TEMP"
            ? "temp"
            : "static";

    // Each declaration line: name : type ; (optional AT/RETAIN/comment)
    const lineRe = /^\s*(\w+)\s*:\s*([\w.]+)/gm;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(body)) !== null) {
      decls.push({ name: lm[1], type: lm[2], kind });
    }
  }

  return decls;
}

// ---------------------------------------------------------------------------
// Step 2 — Extract direct assignments, timer calls, edge calls, fault latches
// ---------------------------------------------------------------------------

function stripComments(scl: string): string {
  // Remove (* ... *) block comments
  let s = scl.replace(/\(\*[\s\S]*?\*\)/g, " ");
  // Remove // line comments
  s = s.replace(/\/\/[^\n]*/g, " ");
  return s;
}

function parseAssignments(scl: string): Assignment[] {
  const clean = stripComments(scl);
  const result: Assignment[] = [];

  // Match: #varName := <expression> ;
  // Use a greedy match up to the next semicolon at top-level
  const re = /#(\w+)\s*:=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    result.push({ lhs: m[1], rhs: m[2].trim() });
  }
  return result;
}

function parseTimerCalls(scl: string): TimerCall[] {
  const clean = stripComments(scl);
  const result: TimerCall[] = [];

  // #timerName(IN := #condition, ...)
  const re = /#(\w+)\s*\(\s*IN\s*:=\s*([^,)]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    result.push({
      timerName: m[1],
      inCondition: m[2].trim(),
    });
  }
  return result;
}

function parseEdgeCalls(scl: string): EdgeCall[] {
  const clean = stripComments(scl);
  const result: EdgeCall[] = [];

  // #edgeName(CLK := #condition)
  const re = /#(\w+)\s*\(\s*CLK\s*:=\s*([^,)]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    result.push({
      edgeName: m[1],
      clkCondition: m[2].trim(),
    });
  }
  return result;
}

function parseFaultLatches(scl: string): FaultLatch[] {
  const clean = stripComments(scl);
  const result: FaultLatch[] = [];

  // IF #condition THEN #latch := TRUE; END_IF;
  // or  #latch := FALSE inside reset blocks
  const re =
    /IF\s+([^T][^H][^E][^N]*?)\s*THEN\s*#(\w+)\s*:=\s*(TRUE|FALSE)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const condition = m[1].trim();
    const latchName = m[2];
    const isSet = m[3].toUpperCase() === "TRUE";
    result.push({ latchName, condition, isSet });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 3 — Simple expression parser → ExprNode tree
// ---------------------------------------------------------------------------

function tokenise(expr: string): string[] {
  // Tokenise a simple SCL expression into tokens
  const tokens: string[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    // Skip whitespace
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    // Parentheses
    if (s[i] === "(" || s[i] === ")") {
      tokens.push(s[i]);
      i++;
      continue;
    }
    // Comparison operators (<=, >=, <>, <, >, =)
    if (s[i] === "<" || s[i] === ">" || s[i] === "=") {
      if (
        i + 1 < s.length &&
        (s[i + 1] === "=" || s[i + 1] === ">")
      ) {
        tokens.push(s[i] + s[i + 1]);
        i += 2;
      } else {
        tokens.push(s[i]);
        i++;
      }
      continue;
    }
    // Identifiers, keywords, numbers — grab until whitespace/paren/operator
    const match = s.slice(i).match(/^[#\w.]+/);
    if (match) {
      tokens.push(match[0]);
      i += match[0].length;
      continue;
    }
    // Skip unknown chars
    i++;
  }
  return tokens;
}

class ExprParser {
  private pos = 0;
  private tokens: string[];
  constructor(tokens: string[]) {
    this.tokens = tokens;
  }

  peek(): string | undefined {
    return this.tokens[this.pos];
  }

  consume(): string {
    return this.tokens[this.pos++] ?? "";
  }

  // or-expr → and-expr (OR and-expr)*
  parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek()?.toUpperCase() === "OR") {
      this.consume();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  // and-expr → unary (AND unary)*
  parseAnd(): ExprNode {
    let left = this.parseUnary();
    while (this.peek()?.toUpperCase() === "AND") {
      this.consume();
      const right = this.parseUnary();
      left = { kind: "and", left, right };
    }
    return left;
  }

  // unary → NOT primary | primary
  parseUnary(): ExprNode {
    if (this.peek()?.toUpperCase() === "NOT") {
      this.consume();
      const child = this.parsePrimary();
      return { kind: "not", child };
    }
    return this.parsePrimary();
  }

  // primary → ( expr ) | #var cmp val | #var | literal
  parsePrimary(): ExprNode {
    const t = this.peek();
    if (!t) return { kind: "literal", value: "" };

    if (t === "(") {
      this.consume(); // (
      const node = this.parseOr();
      if (this.peek() === ")") this.consume();
      return node;
    }

    // Consume identifier
    this.consume();

    // Check for comparison operator
    const op = this.peek();
    if (op && /^(=|<>|<=|>=|<|>)$/.test(op)) {
      this.consume();
      const rhs = this.consume();
      const lhs = t.startsWith("#") ? t.slice(1) : t;
      return { kind: "compare", lhs, op, rhs };
    }

    if (t.startsWith("#")) {
      return { kind: "var", name: t.slice(1) };
    }

    return { kind: "literal", value: t };
  }
}

function parseExpr(exprStr: string): ExprNode {
  const tokens = tokenise(exprStr);
  if (tokens.length === 0) return { kind: "literal", value: exprStr };
  try {
    const parser = new ExprParser(tokens);
    return parser.parseOr();
  } catch {
    return { kind: "literal", value: exprStr };
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Build flow nodes/connections for one column
// ---------------------------------------------------------------------------

interface BuildCtx {
  vars: Map<string, VarDecl>;
  assignments: Assignment[];
  timerCalls: TimerCall[];
  edgeCalls: EdgeCall[];
  faultLatches: FaultLatch[];
  nodeCounter: { n: number };
  depth: number; // prevent infinite recursion
}

function nextId(ctx: BuildCtx): string {
  return `n${ctx.nodeCounter.n++}`;
}

interface SubGraph {
  nodes: FbFlowNode[];
  connections: FbFlowConnection[];
  /** The bottom-most node id that downstream nodes should connect from */
  outId: string;
}

/** Resolve a variable name: follow assignments if it is a temp/static */
function resolveVar(name: string, ctx: BuildCtx): string {
  if (ctx.depth > 6) return name;
  const decl = ctx.vars.get(name);
  if (!decl) return name;
  // Don't follow inputs or outputs — they are sources/sinks
  if (decl.kind === "input" || decl.kind === "output") return name;
  return name;
}

/** Build sub-graph for an ExprNode, returning the output node id */
function buildExprGraph(
  expr: ExprNode,
  outputY: number,
  colX: number,
  ctx: BuildCtx,
  isFault: boolean,
): SubGraph {
  const nodes: FbFlowNode[] = [];
  const connections: FbFlowConnection[] = [];

  switch (expr.kind) {
    case "var": {
      const varName = resolveVar(expr.name, ctx);
      const decl = ctx.vars.get(varName);
      const id = nextId(ctx);

      // Check if this var is a timer .Q reference
      const timerCall = ctx.timerCalls.find(
        (t) => varName === t.timerName,
      );
      const edgeCall = ctx.edgeCalls.find(
        (e) => varName === e.edgeName,
      );

      if (timerCall) {
        // Timer node
        const timerId = id;
        nodes.push({
          id: timerId,
          type: "timer",
          label: `#${varName}.Q`,
          sublabel: "Timer output",
          shape: "rect",
          x: colX,
          y: outputY,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
        // Add the IN condition as an input node above the timer
        if (timerCall.inCondition) {
          const condId = nextId(ctx);
          const condLabel = timerCall.inCondition
            .replace(/#/g, "#")
            .trim();
          const condDecl = ctx.vars.get(
            timerCall.inCondition.replace(/^#/, ""),
          );
          nodes.push({
            id: condId,
            type: condDecl?.kind === "input" ? "input" : "condition",
            label: condLabel,
            shape: "rect",
            x: colX,
            y: outputY - NODE_HEIGHT - V_GAP,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          });
          connections.push({
            fromId: condId,
            toId: timerId,
            type: "normal",
          });
        }
        return { nodes, connections, outId: timerId };
      }

      if (edgeCall) {
        const edgeId = id;
        const edgeType = ctx.vars.get(varName)?.type ?? "R_TRIG";
        const arrow = edgeType === "F_TRIG" ? "↓" : "↑";
        nodes.push({
          id: edgeId,
          type: "condition",
          label: `#${varName} (${arrow} edge)`,
          shape: "rect",
          x: colX,
          y: outputY,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
        return { nodes, connections, outId: edgeId };
      }

      const nodeType: FbFlowNode["type"] =
        decl?.kind === "input"
          ? "input"
          : isFault
            ? "fault"
            : decl?.kind === "static"
              ? "intermediate"
              : "condition";

      const nodeShape: FbFlowNode["shape"] =
        decl?.kind === "static" ? "pill" : "rect";

      nodes.push({
        id,
        type: nodeType,
        label: `#${varName}`,
        shape: nodeShape,
        x: colX,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      return { nodes, connections, outId: id };
    }

    case "not": {
      // Show as variable with "= FALSE" label
      const inner = expr.child;
      if (inner.kind === "var") {
        const id = nextId(ctx);
        const decl = ctx.vars.get(inner.name);
        const nodeType: FbFlowNode["type"] =
          decl?.kind === "input" ? "input" : "condition";
        nodes.push({
          id,
          type: nodeType,
          label: `#${inner.name} = FALSE`,
          shape: "rect",
          x: colX,
          y: outputY,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
        return { nodes, connections, outId: id };
      }
      // fallthrough: treat as condition
      const id = nextId(ctx);
      nodes.push({
        id,
        type: "condition",
        label: "NOT(condition)",
        shape: "rect",
        x: colX,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      return { nodes, connections, outId: id };
    }

    case "compare": {
      const id = nextId(ctx);
      nodes.push({
        id,
        type: "condition",
        label: `#${expr.lhs} ${expr.op} ${expr.rhs}`,
        shape: "rect",
        x: colX,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      return { nodes, connections, outId: id };
    }

    case "and": {
      // AND: stack left above right (series contacts)
      // Flatten all AND children into a list
      const andChildren = flattenAnd(expr);
      const step = NODE_HEIGHT + V_GAP;
      const startY = outputY - (andChildren.length - 1) * step;
      let prevId: string | null = null;

      for (let i = 0; i < andChildren.length; i++) {
        const child = andChildren[i];
        const childY = startY + i * step;
        const sub = buildExprGraph(child, childY, colX, ctx, isFault);
        nodes.push(...sub.nodes);
        connections.push(...sub.connections);

        if (prevId !== null) {
          connections.push({
            fromId: prevId,
            toId: sub.outId,
            type: isFault ? "fault" : "normal",
          });
        }
        prevId = sub.outId;
      }

      return { nodes, connections, outId: prevId! };
    }

    case "or": {
      // OR: place left and right side by side
      const orChildren = flattenOr(expr);
      const mergeId = nextId(ctx);
      const half = Math.floor(orChildren.length / 2);
      const totalW =
        orChildren.length * NODE_WIDTH +
        (orChildren.length - 1) * COL_GAP;
      const startX = colX - (half * (NODE_WIDTH + COL_GAP));

      for (let i = 0; i < orChildren.length; i++) {
        const child = orChildren[i];
        const childX = startX + i * (NODE_WIDTH + COL_GAP);
        const sub = buildExprGraph(
          child,
          outputY - NODE_HEIGHT - V_GAP,
          childX,
          ctx,
          isFault,
        );
        nodes.push(...sub.nodes);
        connections.push(...sub.connections);
        connections.push({
          fromId: sub.outId,
          toId: mergeId,
          type: isFault ? "fault" : "normal",
          label: i === 0 ? "OR" : undefined,
        });
      }

      // Merge node (invisible — just a point, but we need a real node)
      // Use a small pill as merge indicator
      nodes.push({
        id: mergeId,
        type: "intermediate",
        label: "OR",
        shape: "pill",
        x: colX + (totalW - NODE_WIDTH) / 2,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });

      return { nodes, connections, outId: mergeId };
    }

    case "literal": {
      const id = nextId(ctx);
      nodes.push({
        id,
        type: "condition",
        label: expr.value,
        shape: "rect",
        x: colX,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      return { nodes, connections, outId: id };
    }

    case "timer_q": {
      const id = nextId(ctx);
      nodes.push({
        id,
        type: "timer",
        label: `#${expr.timerName}.Q`,
        shape: "rect",
        x: colX,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      return { nodes, connections, outId: id };
    }

    case "edge_q": {
      const id = nextId(ctx);
      nodes.push({
        id,
        type: "condition",
        label: `#${expr.edgeName}.Q`,
        shape: "rect",
        x: colX,
        y: outputY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      return { nodes, connections, outId: id };
    }
  }
}

function flattenAnd(expr: ExprNode): ExprNode[] {
  if (expr.kind !== "and") return [expr];
  return [...flattenAnd(expr.left), ...flattenAnd(expr.right)];
}

function flattenOr(expr: ExprNode): ExprNode[] {
  if (expr.kind !== "or") return [expr];
  return [...flattenOr(expr.left), ...flattenOr(expr.right)];
}

// ---------------------------------------------------------------------------
// Step 5 — Build one column for a VAR_OUTPUT
// ---------------------------------------------------------------------------

function buildColumn(
  outputDecl: VarDecl,
  ctx: BuildCtx,
  baseX: number,
): FbFlowColumn {
  const nodes: FbFlowNode[] = [];
  const connections: FbFlowConnection[] = [];

  const isFault =
    /fault|error|alarm|estop/i.test(outputDecl.name);

  // Output node at the bottom
  const outputNodeId = nextId(ctx);
  const outputY = 400; // will be recalculated in layout pass
  const outputNode: FbFlowNode = {
    id: outputNodeId,
    type: isFault ? "fault" : "output",
    label: `#${outputDecl.name}`,
    shape: "hexagon",
    x: baseX,
    y: outputY,
    width: NODE_WIDTH,
    height: OUTPUT_HEIGHT,
  };
  nodes.push(outputNode);

  // Find the assignment for this output
  const assignment = ctx.assignments.find(
    (a) => a.lhs === outputDecl.name,
  );

  if (!assignment) {
    // Try fault latch pattern
    const faultLatch = ctx.faultLatches.find(
      (f) => f.latchName === outputDecl.name && f.isSet,
    );
    if (faultLatch) {
      const condId = nextId(ctx);
      nodes.push({
        id: condId,
        type: "condition",
        label: faultLatch.condition.replace(/#(\w+)/g, "#$1").trim(),
        sublabel: "fault condition",
        shape: "rect",
        x: baseX,
        y: outputY - NODE_HEIGHT - V_GAP,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      connections.push({
        fromId: condId,
        toId: outputNodeId,
        type: "fault",
      });
    }
    return { outputName: outputDecl.name, nodes, connections };
  }

  const rhs = assignment.rhs;

  // Detect self-hold latch pattern:
  // (#set OR #latch) AND #hold  or variants
  const selfHoldMatch = rhs.match(
    /\(\s*#(\w+)\s+OR\s+#(\w+)\s*\)\s+AND\s+#(\w+)/i,
  );
  if (
    selfHoldMatch &&
    (selfHoldMatch[2] === outputDecl.name ||
      selfHoldMatch[1] === outputDecl.name)
  ) {
    const setVar =
      selfHoldMatch[2] === outputDecl.name
        ? selfHoldMatch[1]
        : selfHoldMatch[2];
    const holdVar = selfHoldMatch[3];

    const setId = nextId(ctx);
    const selfId = nextId(ctx);
    const orMergeId = nextId(ctx);
    const holdId = nextId(ctx);

    const setY = outputY - 3 * (NODE_HEIGHT + V_GAP);
    const orY = outputY - 2 * (NODE_HEIGHT + V_GAP);
    const holdY = outputY - 1 * (NODE_HEIGHT + V_GAP);

    nodes.push(
      {
        id: setId,
        type: "input",
        label: `#${setVar}`,
        shape: "rect",
        x: baseX - NODE_WIDTH / 2 - COL_GAP / 2,
        y: setY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
      {
        id: selfId,
        type: "intermediate",
        label: `#${outputDecl.name} (self-hold)`,
        shape: "pill",
        x: baseX + NODE_WIDTH / 2 + COL_GAP / 2,
        y: setY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
      {
        id: orMergeId,
        type: "intermediate",
        label: "OR",
        shape: "pill",
        x: baseX,
        y: orY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
      {
        id: holdId,
        type: "input",
        label: `#${holdVar}`,
        shape: "rect",
        x: baseX,
        y: holdY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
    );

    connections.push(
      { fromId: setId, toId: orMergeId, type: "normal", label: "OR" },
      { fromId: selfId, toId: orMergeId, type: "selfhold" },
      { fromId: orMergeId, toId: holdId, type: "normal" },
      { fromId: holdId, toId: outputNodeId, type: "normal" },
      // Self-hold feedback
      {
        fromId: outputNodeId,
        toId: selfId,
        type: "selfhold",
        label: "latch",
      },
    );

    return { outputName: outputDecl.name, nodes, connections };
  }

  // General expression parse
  const exprTree = parseExpr(rhs);
  const colX = baseX;
  const sub = buildExprGraph(
    exprTree,
    outputY - NODE_HEIGHT - V_GAP,
    colX,
    ctx,
    isFault,
  );

  nodes.push(...sub.nodes);
  connections.push(...sub.connections);
  connections.push({
    fromId: sub.outId,
    toId: outputNodeId,
    type: isFault ? "fault" : "normal",
  });

  return { outputName: outputDecl.name, nodes, connections };
}

// ---------------------------------------------------------------------------
// Step 6 — Layout pass: normalise Y coordinates within each column
// ---------------------------------------------------------------------------

function layoutColumn(col: FbFlowColumn): FbFlowColumn {
  if (col.nodes.length === 0) return col;

  // Find the output node (hexagon at the bottom)
  const outputNode = col.nodes.find((n) => n.shape === "hexagon");
  if (!outputNode) return col;

  // Sort nodes by original y, then assign clean Y positions top-down
  const sorted = [...col.nodes].sort((a, b) => a.y - b.y);

  let y = DIAGRAM_PADDING;
  const idToNewY = new Map<string, number>();

  for (const node of sorted) {
    idToNewY.set(node.id, y);
    y += (node.shape === "hexagon" ? OUTPUT_HEIGHT : NODE_HEIGHT) + V_GAP;
  }

  const newNodes = col.nodes.map((n) => ({
    ...n,
    y: idToNewY.get(n.id) ?? n.y,
  }));

  return { ...col, nodes: newNodes };
}

// ---------------------------------------------------------------------------
// Step 7 — Group outputs into diagrams
// ---------------------------------------------------------------------------

type OutputGroup = "control" | "fault" | "status";

function classifyOutput(name: string): OutputGroup {
  const lower = name.toLowerCase();
  if (/fault|error|alarm|estop|trip/.test(lower)) return "fault";
  if (
    /busy|idle|status|state|running|ready|done|mode|direction|remaining|current/.test(
      lower,
    )
  )
    return "status";
  return "control";
}

const GROUP_TITLES: Record<OutputGroup, string> = {
  control: "Control Outputs",
  fault: "Fault Outputs",
  status: "Status Outputs",
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function parseFbFlow(sclContent: string): FbFlowDiagram[] {
  if (!sclContent || sclContent.trim().length === 0) return [];

  // Extract FB/FC name
  const nameMatch = sclContent.match(
    /\b(?:FUNCTION_BLOCK|FUNCTION)\s+["']?(\w+)["']?/,
  );
  const fbName = nameMatch ? nameMatch[1] : "Block";

  const decls = parseVarSections(sclContent);
  if (decls.length === 0) return [];

  const varMap = new Map<string, VarDecl>();
  for (const d of decls) varMap.set(d.name, d);

  const outputs = decls.filter((d) => d.kind === "output");
  if (outputs.length === 0) return [];

  const assignments = parseAssignments(sclContent);
  const timerCalls = parseTimerCalls(sclContent);
  const edgeCalls = parseEdgeCalls(sclContent);
  const faultLatches = parseFaultLatches(sclContent);

  const ctx: BuildCtx = {
    vars: varMap,
    assignments,
    timerCalls,
    edgeCalls,
    faultLatches,
    nodeCounter: { n: 0 },
    depth: 0,
  };

  // Build columns
  const allColumns: Array<{ col: FbFlowColumn; group: OutputGroup }> = [];

  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i];
    const baseX = DIAGRAM_PADDING + i * (COL_WIDTH + COL_GAP);
    const raw = buildColumn(out, ctx, baseX);
    const laid = layoutColumn(raw);
    allColumns.push({ col: laid, group: classifyOutput(out.name) });
  }

  // Group into diagrams (max 4 columns per diagram)
  const groupOrder: OutputGroup[] = ["control", "fault", "status"];
  const diagrams: FbFlowDiagram[] = [];

  for (const group of groupOrder) {
    const groupCols = allColumns
      .filter((c) => c.group === group)
      .map((c) => c.col);

    if (groupCols.length === 0) continue;

    // Assign horizontal positions within the group
    const MAX_COLS = 4;
    for (let start = 0; start < groupCols.length; start += MAX_COLS) {
      const slice = groupCols.slice(start, start + MAX_COLS);
      const repositioned = slice.map((col, idx) => {
        const xOffset = idx * (COL_WIDTH + COL_GAP) + DIAGRAM_PADDING;
        return repositionColumn(col, xOffset);
      });

      const suffix =
        groupCols.length > MAX_COLS
          ? ` (${Math.floor(start / MAX_COLS) + 1})`
          : "";

      diagrams.push({
        title: `${fbName} — ${GROUP_TITLES[group]}${suffix}`,
        columns: repositioned,
      });
    }
  }

  return diagrams;
}

/** Shift all node X coordinates in a column to a new base X */
function repositionColumn(col: FbFlowColumn, baseX: number): FbFlowColumn {
  if (col.nodes.length === 0) return col;

  // Find the current minimum X
  const minX = Math.min(...col.nodes.map((n) => n.x));
  const shift = baseX - minX;

  return {
    ...col,
    nodes: col.nodes.map((n) => ({ ...n, x: n.x + shift })),
  };
}
