import type { CodegenArtifact, EmSeqState, EmSeqStep, EmSequence } from "./types";
import { regionId, renderRegion, defaultStub } from "./em-fill-regions";

const PROGRAM = "Program blocks";
const DATA = "PLC data types";

function pad(n: number): string {
  return " ".repeat(n);
}

/** Entry assignment for a transition; sequential targets also reset #step. */
function enterStmt(toIndex: number, targetSequential: boolean): string {
  const base = `#state := ${toIndex}; #done := FALSE;`;
  return targetSequential ? `${base} #step := 1;` : base;
}

/** One outgoing edge as a guarded transition. Completion edges gate on #done;
 *  command edges gate on their serialized condition. */
function exitLine(
  exit: EmSeqState["exits"][number], states: EmSeqState[], indent: number,
): string {
  const enter = enterStmt(exit.toIndex, states[exit.toIndex].kind === "sequential");
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

/** Lower one state to its CASE branch lines. */
function stateBranch(seq: EmSequence, st: EmSeqState, states: EmSeqState[]): string[] {
  const out: string[] = [`${pad(6)}${st.index}:   // ${st.name}${st.isSafe ? " (safe)" : ""}`];
  if (st.kind === "sequential") {
    out.push(`${pad(9)}CASE #step OF`);
    st.steps.forEach((step, i) => {
      out.push(`${pad(12)}${step.step}:`);
      out.push(renderRegion(regionId(seq.sclName, step.fillId), defaultStub(step.actionProse, pad(15)), pad(15)));
      out.push(advanceLine(step, i === st.steps.length - 1, 15));
    });
    out.push(`${pad(9)}END_CASE;`);
  } else {
    for (const c of st.staticCommands) {
      out.push(`${pad(9)}#${c.pin} := ${c.active ? "TRUE" : "FALSE"};`);
    }
  }
  for (const exit of st.exits) out.push(exitLine(exit, states, 9));
  // every CASE branch must hold at least one statement
  if (st.kind === "static" && !st.staticCommands.length && !st.exits.length) {
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

/** Command DB — the Unit/HMI seam that drives the EM's command inputs. */
function writeCmdDb(seq: EmSequence): CodegenArtifact {
  const name = `${seq.sclName}_CMD`;
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   STRUCT`,
    `      enable : Bool;`,
    `      mode : Int;`,
    ...seq.cmdPins.map((p) => `      ${p} : Bool;`),
    `   END_STRUCT;`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** MAP FC — the IO seam between physical addresses and the instance DB. */
function writeMapFc(seq: EmSequence): CodegenArtifact {
  const inst = `EM_${seq.sclName}_DB`;
  const name = `MAP_${seq.sclName}`;
  const sensorLines = seq.sensors.map((p) =>
    p.address
      ? `   "${inst}".${p.name} := "${p.address}";`
      : `   // TODO wire sensor ${p.name} (no address in spec)`,
  );
  const actuatorLines = seq.actuators.map((p) =>
    p.address
      ? `   "${p.address}" := "${inst}".${p.name};`
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
  const cmd = `${seq.sclName}_CMD`;
  const params = [
    `enable := "${cmd}".enable`,
    `mode := "${cmd}".mode`,
    ...seq.cmdPins.map((p) => `${p} := "${cmd}".${p}`),
  ].join(", ");
  return [`   "${inst}"(${params});`, `   "MAP_${seq.sclName}"();`];
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
