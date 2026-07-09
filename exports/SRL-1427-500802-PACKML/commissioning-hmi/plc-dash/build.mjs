// build.mjs — generate the PLC-hosted dashboard page from ../index.html.
// The UI stays byte-identical except: (1) plc-client.js is injected before the
// main script, (2) every server call site fetch("/...") becomes dashFetch("/..."),
// which plc-client.js implements against the same-origin S7-1200 G2 Web API.
// Re-run after any edit to ../index.html to keep the PLC build in sync.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");

// 1. reroute the 10 server call sites to the in-page client
let out = src.replaceAll('fetch("/', 'dashFetch("/');
const n = (src.match(/fetch\("\//g) || []).length;

// 2. inject the PLC client before the main UI script (dashFetch must exist
//    before the UI's tick() runs)
const anchor = "<script>\nconst $ = (id) => document.getElementById(id);";
if (!out.includes(anchor)) throw new Error("main-script anchor not found — ../index.html changed shape, update build.mjs");
out = out.replace(anchor, '<script src="plc-client.js"></script>\n' + anchor);

// 3. mark the variant in the title
out = out.replace(/<title>([^<]*)<\/title>/, "<title>$1 · PLC-hosted</title>");

fs.writeFileSync(path.join(here, "index.html"), out);
console.log(`built plc-dash/index.html — rerouted ${n} fetch sites, injected plc-client.js`);
