import indexHtml from "./runtime/index.html?raw";
import stylesCss from "./runtime/styles.css?raw";
import transportJs from "./runtime/plc-transport.js?raw";
import appJs from "./runtime/dashboard-app.js?raw";
import mimicJs from "./runtime/mimic.js?raw";
import serverMjs from "./runtime/server.mjs?raw";

/**
 * Static runtime files for the generated commissioning dashboard, inlined as
 * string constants so the emitter can produce a downloadable bundle with no
 * filesystem access (browser-safe). Consumed by dashboard-emit.ts and the
 * generation hook.
 */
export const RUNTIME_FILES: Record<string, string> = {
  "index.html": indexHtml,
  "styles.css": stylesCss,
  "plc-transport.js": transportJs,
  "mimic.js": mimicJs,
  "dashboard-app.js": appJs,
  "server.mjs": serverMjs,
};
