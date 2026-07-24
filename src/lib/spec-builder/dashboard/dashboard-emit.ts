import type { DashboardModel } from "@/types/commissioning-dashboard";

/**
 * Serializes a DashboardModel into a script that assigns it to a global
 * (`window.__DASH_MODEL__`) for the static dashboard runtime to consume.
 * Pure string formatting — no IO, no Date.now() (the generated note is
 * carried on the model itself).
 */
export function serializeModel(model: DashboardModel): string {
  return `window.__DASH_MODEL__ = ${JSON.stringify(model, null, 2)};\n`;
}

/** Renders the bundle's README.md from the model's project metadata + warnings. */
export function renderReadme(model: DashboardModel): string {
  return [
    `# ${model.project.name} — Commissioning Dashboard`,
    ``,
    model.project.generatedNote,
    ``,
    `## Run`,
    ``,
    `    node server.mjs        # serves http://localhost:8099`,
    ``,
    `Transports (toggle in the header):`,
    `- **Sim** — the PacForge bridge at http://localhost:5102 with a PLCSIM instance in RUN.`,
    `- **PLC** — a real PLC's Web API (open the dashboard from the PLC or set the PLC IP).`,
    ``,
    model.warnings.length ? `## Generation warnings\n\n${model.warnings.map((w) => `- ${w}`).join("\n")}\n` : ``,
  ].join("\n");
}

/**
 * Serializes a DashboardModel into a portable file map: every entry from the
 * fixed static runtime (supplied by the caller), plus the generated
 * `dash-model.js` and `README.md`.
 */
export function emitDashboard(
  model: DashboardModel,
  runtimeFiles: Record<string, string>,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, content] of Object.entries(runtimeFiles)) files.set(name, content);
  files.set("dash-model.js", serializeModel(model));
  files.set("README.md", renderReadme(model));
  return files;
}
