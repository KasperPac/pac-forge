import type { CodegenArtifact, EmSeqState, EmSeqStep, EmSequence } from "./types";
import { regionId, renderRegion, defaultStub } from "./em-fill-regions";
import { buildCommandSeam, type CommandSeamPin } from "./em-command-seam";

const PROGRAM = "Program blocks";
const DATA = "PLC data types";

function pad(n: number): string {
  return " ".repeat(n);
}

/** Entry assignment for a transition; targets that carry steps also reset #step. */
function enterStmt(toIndex: number, targetHasSteps: boolean): string {
  const base = `#state := ${toIndex}; #done := FALSE;`;
  return targetHasSteps ? `${base} #step := 1;` : base;
}

/** One outgoing edge as a guarded transition. Completion edges gate on #done;
 *  command edges gate on their serialized condition. The #step reset is chosen
 *  by the data the target carries (steps), matching stateBranch — never kind. */
function exitLine(
  exit: EmSeqState["exits"][number], states: EmSeqState[], indent: number,
): string {
  const enter = enterStmt(exit.toIndex, states[exit.toIndex].steps.length > 0);
  if (exit.viaCompletion) {
    const gate = exit.condition === "TRUE" ? "#done" : `#done AND ${exit.condition}`;
    return `${pad(indent)}IF ${gate} THEN ${enter} END_IF;`;
  }
  return `${pad(indent)}IF ${exit.condition} THEN ${enter} END_IF;`;
}

/** Advance after a step body: the last step sets #done, others bump #step. An
 *  always-true advance is emitted unconditionally. */
function advanceLine(step: EmSeqStep, isLast: boolean, indent: number): string {
  const target = isLast ? `#done := TRUE;` : `#step := ${step.step + 1};`;
  if (step.advance === "TRUE") return `${pad(indent)}${target}`;
  return `${pad(indent)}IF ${step.advance} THEN ${target} END_IF;`;
}

/** Lower one state to its CASE branch lines. The body is chosen by the data
 *  the state carries (command branches → hold chain, steps → step CASE, else
 *  static holds), never its kind — a mis-authored kind never drops behavior. */
function stateBranch(seq: EmSequence, st: EmSeqState, states: EmSeqState[]): string[] {
  const out: string[] = [`${pad(6)}${st.index}:   // ${st.name}${st.isSafe ? " (safe)" : ""}`];
  const isCommand = st.commandBranches.length > 0 || st.commandDefaults.length > 0;
  if (isCommand) {
    // command-driven hold state: fully deterministic, no ai-fill region, no
    // #done — it holds until a contract transition exits it
    out.push(`${pad(9)}// command-conditional holds (defaults first, active branch overrides)`);
    for (const d of st.commandDefaults) out.push(`${pad(9)}#${d.pin} := ${d.value};`);
    st.commandBranches.forEach((b, i) => {
      out.push(`${pad(9)}${i === 0 ? "IF" : "ELSIF"} ${b.condition} THEN`);
      out.push(`${pad(12)}// ${b.label}`);
      if (!b.holds.length) out.push(`${pad(12)};`);
      for (const h of b.holds) out.push(`${pad(12)}#${h.pin} := ${h.value};`);
    });
    if (st.commandBranches.length) out.push(`${pad(9)}END_IF;`);
  } else if (st.steps.length) {
    out.push(`${pad(9)}CASE #step OF`);
    st.steps.forEach((step, i) => {
      out.push(`${pad(12)}${step.step}:`);
      out.push(renderRegion(regionId(seq.sclName, step.fillId), defaultStub(step.actionProse, pad(15)), pad(15)));
      out.push(advanceLine(step, i === st.steps.length - 1, 15));
    });
    out.push(`${pad(9)}END_CASE;`);
  } else {
    for (const c of st.staticCommands) {
      out.push(`${pad(9)}#${c.pin} := ${c.value};`);
    }
  }
  for (const exit of st.exits) out.push(exitLine(exit, states, 9));
  // every CASE branch must hold at least one statement
  if (!isCommand && !st.steps.length && !st.staticCommands.length && !st.exits.length) {
    out.push(`${pad(9)};`);
  }
  return out;
}

/** The procedural EM Function Block: typed interface + CASE state/step skeleton
 *  with AI-fill regions for the step bodies. */
function writeFb(seq: EmSequence): CodegenArtifact {
  const name = `EM_${seq.sclName}`;
  const inputs = [
    `      enable : Bool;`,
    `      mode : Int;`,
    ...seq.cmdPins.map((p) => `      ${p} : Bool;`),
    ...seq.setpointPins.map((p) => `      ${p} : Int;`),
    ...seq.interlockPins.map((p) => `      ${p} : Bool;`),
    ...seq.sensors.map((p) => `      ${p.name} : ${p.scl_type};`),
  ];
  const outputs = [
    `      state : Int;`,
    `      step : Int;`,
    `      done : Bool;`,
    `      fault : Bool;`,
    ...seq.actuators.map((p) => `      ${p.name} : ${p.scl_type};`),
  ];
  const body = seq.states.flatMap((st) => stateBranch(seq, st, seq.states));
  const content = [
    `FUNCTION_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_INPUT`, ...inputs, `   END_VAR`,
    `   VAR_OUTPUT`, ...outputs, `   END_VAR`,
    ``,
    `BEGIN`,
    `   CASE #state OF`,
    ...body,
    `   END_CASE;`,
    `END_FUNCTION_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "FB", filename: `${name}.scl`, content, dependencies: [], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** Status UDT mirroring the FB's status outputs. */
function writeStateUdt(seq: EmSequence): CodegenArtifact {
  const name = `EM_${seq.sclName}_State`;
  const content = [
    `TYPE "${name}"`,
    `VERSION : 0.1`,
    `   STRUCT`,
    `      state : Int;`,
    `      step : Int;`,
    `      done : Bool;`,
    `      fault : Bool;`,
    `   END_STRUCT;`,
    `END_TYPE`,
    ``,
  ].join("\n");
  return { name, type: "UDT", filename: `${name}.udt`, content, dependencies: [], folder: DATA, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** The fixed command-seam pins every synthesized EM FB exposes. */
function commandPins(seq: EmSequence): CommandSeamPin[] {
  return [
    { name: "enable", scl_type: "Bool" },
    { name: "mode", scl_type: "Int" },
    ...seq.cmdPins.map((p) => ({ name: p, scl_type: "Bool" as const })),
    ...seq.setpointPins.map((p) => ({ name: p, scl_type: "Int" as const })),
  ];
}

/** Command DB — the Unit/HMI seam that drives the EM's command inputs. */
function writeCmdDb(seq: EmSequence): CodegenArtifact {
  const { cmdDb } = buildCommandSeam(seq.sclName, commandPins(seq));
  return { ...cmdDb, ownerId: seq.emId, ownerName: seq.emName };
}

/** MAP FC — the IO seam between physical addresses and the instance DB. */
function writeMapFc(seq: EmSequence): CodegenArtifact {
  const inst = `EM_${seq.sclName}_DB`;
  const name = `MAP_${seq.sclName}`;
  // wire by symbolic PLC tag (the IO-register name); the address rides along
  // as a comment — the tag table owns the physical binding
  const sensorLines = seq.sensors.map((p) =>
    p.address
      ? `   "${inst}".${p.name} := "${p.tag}";   // %${p.address}`
      : `   // TODO wire sensor ${p.name} (no address in spec)`,
  );
  const actuatorLines = seq.actuators.map((p) =>
    p.address
      ? `   "${p.tag}" := "${inst}".${p.name};   // %${p.address}`
      : `   // TODO wire actuator ${p.name} (no address in spec)`,
  );
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   // sensor feedback: physical input -> instance DB`,
    ...sensorLines,
    `   // actuator commands: instance DB -> physical output`,
    ...actuatorLines,
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies: [inst], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** Instance DB for the EM FB. */
function writeInstanceDb(seq: EmSequence): CodegenArtifact {
  const fbName = `EM_${seq.sclName}`;
  const name = `EM_${seq.sclName}_DB`;
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `"${fbName}"`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [fbName], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** OB1 call lines: instantiate the FB from its CMD DB, then run its MAP FC. */
function buildCallLines(seq: EmSequence): string[] {
  const inst = `EM_${seq.sclName}_DB`;
  const { callBindings } = buildCommandSeam(seq.sclName, commandPins(seq));
  return [`   "${inst}"(${callBindings.join(", ")});`, `   "MAP_${seq.sclName}"();`];
}

/** Serialize an EmSequence into its 5 SCL artifacts plus OB1 call lines. Pure;
 *  no IO, no AI. The FB step bodies are deterministic stubs inside stable
 *  AI-fill regions, so the bundle always compiles before any AI fill. */
export function writeEmArtifacts(seq: EmSequence): {
  artifacts: CodegenArtifact[]; callLines: string[];
} {
  return {
    artifacts: [
      writeFb(seq),
      writeStateUdt(seq),
      writeCmdDb(seq),
      writeMapFc(seq),
      writeInstanceDb(seq),
    ],
    callLines: buildCallLines(seq),
  };
}
