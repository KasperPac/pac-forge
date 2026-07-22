// src/lib/spec-builder/hmi/hmi-build-pack.ts
//
// G7-8 lowering #2 — HMI IR → build-by-numbers markdown (the generated
// equivalent of the hand-authored HMI-BUILD-PACK.md). Always produced: it is
// the human-auditable spec, and the carrier for every step the bridge cannot
// author natively yet.
import type { HmiIr, HmiScreenItem } from "./hmi-ir";

function itemRow(item: HmiScreenItem): string {
  switch (item.kind) {
    case "state_field":
      return `| ${item.label} | \`${item.tag}\` | state field → text list \`${item.textList}\` |`;
    case "numeric_field": {
      const bits = [
        item.writable ? "IO field (writable)" : "readout",
        item.unit ? `unit ${item.unit}` : undefined,
        item.limits ? `limits ${item.limits.min ?? "—"}..${item.limits.max ?? "—"}` : undefined,
        item.requiredLevel !== undefined ? `level ≥ ${item.requiredLevel}` : undefined,
      ].filter(Boolean);
      return `| ${item.label} | \`${item.tag}\` | ${bits.join(", ")} |`;
    }
    case "lamp":
      return `| ${item.label} | \`${item.tag}\` | lamp — on when ${item.onValue} |`;
    case "toggle":
      return `| ${item.label} | \`${item.tag}\` | toggle${item.requiredLevel !== undefined ? ` (level ≥ ${item.requiredLevel})` : ""} |`;
    case "button_momentary":
      return `| ${item.label} | \`${item.tag}\` | momentary button — set on press, reset on release |`;
    case "alarm_control":
      return `| ${item.label} | — | Unified Alarm control (active + logged) + ACK button |`;
  }
}

/** Render the IR (+ the bridge lowering's manual steps) as build-pack markdown. */
export function renderHmiBuildPack(
  ir: HmiIr,
  opts?: { projectName?: string; manualSteps?: string[] },
): string {
  const lines: string[] = [
    `# ${opts?.projectName ?? "Generated"} — HMI Build Pack`,
    ``,
    `Build-by-numbers spec derived deterministically from the FDS. Every tag`,
    `below is emitted by the generated PLC code — symbolic bindings only`,
    `(optimized DBs, no PUT/GET, no absolute addressing).`,
    ``,
  ];

  for (const screen of ir.screens) {
    lines.push(
      `## Screen: ${screen.title}${screen.requiredLevel !== undefined ? ` (role level ≥ ${screen.requiredLevel})` : ""}`,
      ``,
      `| Element | Tag | Display |`,
      `|---|---|---|`,
      ...screen.items.map(itemRow),
      ``,
    );
  }

  if (ir.alarms.length) {
    lines.push(
      `## Discrete alarms`,
      ``,
      `| # | Tag | Trigger | Class | Text |`,
      `|---|---|---|---|---|`,
      ...ir.alarms.map(
        (a, i) => `| ${i + 1} | \`${a.tag}\` | =${a.triggerValue} | ${a.className} | ${a.text} |`,
      ),
      ``,
    );
  }

  if (ir.textLists.length) {
    lines.push(`## State text lists (index → text)`, ``);
    for (const l of ir.textLists) {
      lines.push(`- **${l.name}** (\`${l.stateTag}\`): ${l.entries.map((e) => `${e.index} ${e.text}`).join(" · ")}`);
    }
    lines.push(``);
  }

  if (ir.roles.length) {
    lines.push(
      `## Access roles`,
      ``,
      `| Role | Level |`,
      `|---|---|`,
      ...ir.roles.map((r) => `| ${r.name} | ${r.level} |`),
      ``,
    );
  }

  if (opts?.manualSteps?.length) {
    lines.push(
      `## Manual build steps (not yet bridge-automated)`,
      ``,
      ...opts.manualSteps.map((s, i) => `${i + 1}. ${s}`),
      ``,
    );
  }

  return lines.join("\n");
}
