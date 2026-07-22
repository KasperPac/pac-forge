// CVL-2129 Freezer — read-only live-data dashboard over the S7-1500 Web API.
// Runs on any PC that can reach the PLC; the browser talks to THIS server only,
// so no CORS / certificate fuss on the client side.
//
//   node server.mjs <plc-ip> [user] [password]     (default Anonymous / empty)
//   browser: http://localhost:8080
//
// MONITORING ONLY — this server never calls PlcProgram.Write. The PLC user
// (or the "Everybody" user) needs only the web server "read variables" right.
// Tag register lives in tags.mjs (generated from the TIA project via the
// Pac-Forge bridge — regenerate there, don't hand-edit).
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IO_TAGS, PROJECT } from "./tags.mjs";
import { createEventEngine } from "./events.mjs";
import { PLC_LOG, decodeEntry } from "./plc-log.mjs";

const PLC_IP = process.argv[2] ?? process.env.PLC_IP ?? "192.168.0.1";
const PLC_USER = process.argv[3] ?? process.env.PLC_USER ?? "Anonymous";
const PLC_PASS = process.argv[4] ?? process.env.PLC_PASS ?? "";
// test-only knobs (mock-plc.mjs): real PLCs are always https on 443
const PLC_PORT = Number(process.env.PLC_PORT ?? 443);
const PLC_PLAIN_HTTP = process.env.PLC_PLAIN_HTTP === "1";
if (PLC_USER === "Anonymous") console.log("[plc] running as Anonymous — the Everybody web user must hold the read-variables right");
const HTTP_PORT = Number(process.env.PORT ?? 8080);
const here = path.dirname(fileURLToPath(import.meta.url));

// ---- poll register ---------------------------------------------------------
// IO_TAGS: [{ name, addr, type, comment, table, kind }] with kind di|do|ai|ao.
// WATCH: ad-hoc "Db.member" ids added from the UI, persisted across restarts.
const WATCH_FILE = path.join(here, "watch.json");
let watch = [];
try { watch = JSON.parse(fs.readFileSync(WATCH_FILE, "utf8")); } catch {}
const saveWatch = () => fs.writeFileSync(WATCH_FILE, JSON.stringify(watch, null, 2));

// IO tags are plain PLC tags — quoted WHOLE (IEC names like "=GND+CB8-H.001"
// contain dots that are part of the name, not a member path). Watch entries
// are DB paths: "Db.member.sub" -> '"Db".member.sub' — unless the id is a
// known plain tag, in which case it is also quoted whole.
const IO_NAMES = new Set(IO_TAGS.map((t) => t.name));
const plcVar = (id) => {
  const i = id.indexOf(".");
  return i < 0 || IO_NAMES.has(id) ? `"${id}"` : `"${id.slice(0, i)}".${id.slice(i + 1)}`;
};
const events = createEventEngine(here);
// PLC ring-buffer log (EVENT_LOGGER FB in the PLC). When present it becomes
// THE event source — scan-accurate, survives server outages — and the
// poll-based rules + their extra reads are switched off automatically.
const plcLog = { active: false, lastSeq: null, stateFile: path.join(here, "logs", "plc-drain-state.json") };
try { plcLog.lastSeq = JSON.parse(fs.readFileSync(plcLog.stateFile, "utf8")).lastSeq; } catch {}
const savePlcState = () => { try { fs.mkdirSync(path.join(here, "logs"), { recursive: true }); fs.writeFileSync(plcLog.stateFile, JSON.stringify({ lastSeq: plcLog.lastSeq })); } catch {} };

const readItems = () => [
  ...IO_TAGS.map((t) => ({ id: t.name, v: `"${t.name}"` })),
  ...(plcLog.active ? [] : events.varIds.map((w) => ({ id: w, v: plcVar(w) }))),
  ...watch.map((w) => ({ id: w, v: plcVar(w) })),
];

// ---- JSON-RPC over self-signed HTTPS --------------------------------------
let token = null;
const state = { connected: false, values: {}, errors: {}, error: null, lastPollMs: 0 };

function rpc(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = (PLC_PLAIN_HTTP ? http : https).request({
      host: PLC_IP, port: PLC_PORT, path: "/api/jsonrpc", method: "POST", rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        ...(token ? { "X-Auth-Token": token } : {}),
      },
      timeout: 5000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(body);
  });
}

let lastLoginAt = 0;
async function login() {
  // never hammer Api.Login — the session pool is finite and sessions linger
  const wait = lastLoginAt + 10_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLoginAt = Date.now();
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "Api.Login", params: { user: PLC_USER, password: PLC_PASS } });
  if (r.error) throw new Error(`Api.Login: ${JSON.stringify(r.error)}`);
  token = r.result.token;
  console.log(`[plc] logged in as ${PLC_USER}`);
}

async function logout() {
  if (!token) return;
  try { await rpc({ jsonrpc: "2.0", id: 1, method: "Api.Logout", params: {} }); } catch {}
  token = null;
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await logout(); process.exit(0); });

const isAuthError = (e) => e && (e.code === 1 || /unauthori|not authenticated|invalid token/i.test(e.message ?? ""));

const CHUNK = 100; // reads per JSON-RPC batch — keep individual requests modest
async function pollLoop() {
  for (;;) {
    const t0 = Date.now();
    try {
      if (!token) await login();
      const items = readItems();
      let sawAuthError = false, denied = 0, total = 0;
      for (let c = 0; c < items.length; c += CHUNK) {
        const slice = items.slice(c, c + CHUNK);
        const batch = slice.map((it, i) => ({
          jsonrpc: "2.0", id: i + 1, method: "PlcProgram.Read", params: { var: it.v, mode: "simple" },
        }));
        const res = await rpc(batch);
        const rows = Array.isArray(res) ? res : [res];
        const byId = new Map(rows.map((r) => [r.id, r]));
        slice.forEach((it, i) => {
          const r = byId.get(i + 1);
          state.values[it.id] = r && !r.error ? r.result : null;
          if (r?.error) state.errors[it.id] = r.error.message ?? String(r.error.code); else delete state.errors[it.id];
        });
        sawAuthError = sawAuthError || rows.some((r) => isAuthError(r.error));
        denied += rows.filter((r) => r.error?.code === 2).length;
        total += rows.length;
      }
      // drop the session ONLY on a genuine auth error — permission errors etc.
      // keep the session (re-logging-in can't fix those and leaks sessions)
      if (sawAuthError) token = null;
      state.connected = true;
      state.error = total > 0 && denied === total ? "all reads: permission denied — check web server rights" : null;
      // one-shot: resolve device names for event texts (static — read once)
      if (!events.haveDeviceNames) {
        const batch = events.oneShotIds.map((id, i) => ({
          jsonrpc: "2.0", id: i + 1, method: "PlcProgram.Read", params: { var: plcVar(id), mode: "simple" },
        }));
        const rows = await rpc(batch).then((r) => (Array.isArray(r) ? r : [r])).catch(() => []);
        if (rows.length) {
          const names = {};
          events.oneShotIds.forEach((id, i) => {
            const r = rows.find((x) => x.id === i + 1);
            const idx = Number(id.match(/\[(\d+)\]/)?.[1]);
            if (r && !r.error && r.result) names[idx] = r.result;
          });
          events.setDeviceNames(names);
        }
      }
      await drainPlcLog();
      if (!plcLog.active) events.tick(state.values); // poll rules only without the PLC logger
    } catch (e) {
      state.connected = false;
      state.error = e.message;
      // network-level failure: keep the token (it's still valid on the PLC)
      await new Promise((r) => setTimeout(r, 2000));
    }
    state.lastPollMs = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 750));
  }
}

// ---- PLC ring-buffer drain --------------------------------------------------
async function readVars(vars) {
  const batch = vars.map((v, i) => ({ jsonrpc: "2.0", id: i + 1, method: "PlcProgram.Read", params: { var: v, mode: "simple" } }));
  const res = await rpc(batch);
  const rows = Array.isArray(res) ? res : [res];
  return vars.map((_, i) => { const r = rows.find((x) => x.id === i + 1); return r && !r.error ? r.result : null; });
}

async function drainPlcLog() {
  let head;
  try { [head] = await readVars([`"${PLC_LOG.db}".Head`]); } catch { head = null; }
  if (head == null) { plcLog.active = false; return; } // DB absent/unreadable -> poll rules stay on
  const firstContact = !plcLog.active;
  plcLog.active = true;
  if (plcLog.lastSeq == null || plcLog.lastSeq > head) {
    // first ever contact (or PLC log was cleared/reset): replay what the buffer holds
    plcLog.lastSeq = Math.max(0, head - PLC_LOG.size);
  }
  if (head === plcLog.lastSeq) return;
  if (firstContact) console.log(`[plclog] PLC event log detected (head=${head}) — scan-accurate logging active`);
  const from = Math.max(plcLog.lastSeq, head - PLC_LOG.size) + 1; // older entries are overwritten
  if (from > plcLog.lastSeq + 1) console.log(`[plclog] ${from - plcLog.lastSeq - 1} event(s) lost to ring overwrite`);
  for (let seq = from; seq <= head; seq++) {
    const idx = (seq - 1) % PLC_LOG.size;
    const vars = PLC_LOG.entryMembers.map((m) => `"${PLC_LOG.db}".Entries[${idx}].${m}`);
    try {
      const vals = await readVars(vars);
      const e = Object.fromEntries(PLC_LOG.entryMembers.map((m, i) => [m, vals[i]]));
      if (e.Seq !== seq) continue; // slot overwritten while draining — skip
      events.ingest(decodeEntry(e));
    } catch { break; } // comms hiccup: retry from lastSeq next cycle
    plcLog.lastSeq = seq;
  }
  savePlcState();
}

// ---- HTTP -----------------------------------------------------------------
const readBody = (req) => new Promise((resolve) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b));
});

http.createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(path.join(here, "index.html")));
    } else if (req.url === "/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...state, project: PROJECT, io: IO_TAGS, watch,
        events: { recent: events.recent(150), counts: events.counts(), plcLog: plcLog.active } }));
    } else if (req.url?.startsWith("/events/download")) {
      // today's raw JSONL (one event per line) for offline analysis
      const day = new URL(req.url, "http://x").searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
      const f = path.join(here, "logs", `events-${day}.jsonl`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !fs.existsSync(f)) { res.writeHead(404); return res.end("no log for " + day); }
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Content-Disposition": `attachment; filename="events-${day}.jsonl"` });
      res.end(fs.readFileSync(f));
    } else if (req.url === "/watch/add" && req.method === "POST") {
      const { id } = JSON.parse(await readBody(req));
      const clean = String(id ?? "").trim().replaceAll('"', "");
      if (!clean) { res.writeHead(400); return res.end('{"ok":false,"error":"empty id"}'); }
      if (!watch.includes(clean)) { watch.push(clean); saveWatch(); }
      res.writeHead(200); res.end('{"ok":true}');
    } else if (req.url === "/watch/remove" && req.method === "POST") {
      const { id } = JSON.parse(await readBody(req));
      watch = watch.filter((w) => w !== id);
      delete state.values[id]; delete state.errors[id];
      saveWatch();
      res.writeHead(200); res.end('{"ok":true}');
    } else { res.writeHead(404); res.end(); }
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); }
}).listen(HTTP_PORT, () => console.log(`[http] dashboard on http://localhost:${HTTP_PORT} — PLC https://${PLC_IP}/api/jsonrpc (read-only)`));

pollLoop();
