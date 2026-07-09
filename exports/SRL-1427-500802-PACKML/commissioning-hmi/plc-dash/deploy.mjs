// deploy.mjs — push the PLC-hosted dashboard onto the S7-1200 G2 web server
// as a custom web application, over the Web API alone (no TIA, no download,
// machine keeps running). Idempotent: re-run to update.
//
//   node deploy.mjs <plc-ip> <user> <password> [--set-plc-default]
//
// After deploy: https://<plc-ip>/~dash/  (login prompt = PLC user)
// --set-plc-default additionally makes the bare IP land on the dashboard.
//
// Run build.mjs first if ../index.html changed.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // PLC cert is self-signed
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [ip, user, pass] = process.argv.slice(2);
const setPlcDefault = process.argv.includes("--set-plc-default");
if (!ip || !user || !pass) {
  console.error("usage: node deploy.mjs <plc-ip> <user> <password> [--set-plc-default]");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const APP = "dash";
const FILES = [
  ["index.html", "text/html"],
  ["plc-client.js", "application/javascript"],
];

let token = null;
let rpcId = 0;
async function rpc(method, params) {
  const r = await fetch(`https://${ip}/api/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Auth-Token": token } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }),
  });
  const j = await r.json();
  if (j.error) { const e = new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)} (code ${j.error.code})`); e.code = j.error.code; throw e; }
  return j.result;
}
const tryRpc = (m, p) => rpc(m, p).catch((e) => { console.log(`  (${m}: ${e.message})`); return null; });

try {
  // 1. login + permission check
  const login = await rpc("Api.Login", { user, password: pass });
  token = login.token;
  console.log(`[1/5] logged in as ${user}`);
  const perms = await rpc("Api.GetPermissions", {});
  const names = (perms ?? []).map((p) => p.name ?? p);
  console.log(`      permissions: ${names.join(", ")}`);
  if (!names.some((n) => /user_pages|webapp|web_app/i.test(n)))
    console.warn("      WARNING: no web-app management permission visible — WebApp.Create may be denied.\n" +
      "      Fix: Security settings → Users and roles → role of this user → runtime rights → manage user pages, then download.");

  // 2. create (or reuse) the web application
  const apps = await rpc("WebApp.Browse", {});
  const existing = (apps.applications ?? apps ?? []).find?.((a) => a.name === APP);
  if (existing) console.log(`[2/5] web app '${APP}' exists — updating`);
  else { await rpc("WebApp.Create", { application: { name: APP, state: "enabled" } }).catch(async (e) => {
      // some firmwares take flat params
      if (e.code === -32602) await rpc("WebApp.Create", { name: APP, state: "enabled" }); else throw e;
    }); console.log(`[2/5] web app '${APP}' created`); }

  // 3. upload resources (delete-then-create so re-deploys refresh content)
  for (const [file, mediaType] of FILES) {
    const bytes = fs.readFileSync(path.join(here, file));
    await tryRpc("WebApp.DeleteResource", { app_name: APP, name: file });
    let ticket;
    const params = {
      app_name: APP, name: file, media_type: mediaType,
      last_modified: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      visibility: "public", // page loads without a web session; DATA still requires Api.Login
    };
    try { ticket = await rpc("WebApp.CreateResource", params); }
    catch (e) { // some firmwares want {resource:{...}}
      if (e.code === -32602) ticket = await rpc("WebApp.CreateResource", { app_name: APP, resource: params });
      else throw e;
    }
    const up = await fetch(`https://${ip}/api/ticket?id=${encodeURIComponent(ticket)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Auth-Token": token }, body: bytes,
    });
    if (!up.ok) throw new Error(`ticket upload for ${file} failed: HTTP ${up.status} ${await up.text()}`);
    await tryRpc("Api.CloseTicket", { id: ticket });
    console.log(`[3/5] uploaded ${file} (${bytes.length} bytes)`);
  }

  // 4. default page inside the app
  await rpc("WebApp.SetDefaultPage", { app_name: APP, resource_name: "index.html" })
    .catch(async (e) => { if (e.code === -32602) await rpc("WebApp.SetDefaultPage", { name: APP, resource_name: "index.html" }); else throw e; });
  console.log(`[4/5] default page set → https://${ip}/~${APP}/`);

  // 5. optionally make the bare IP land on the dashboard
  if (setPlcDefault) {
    const ok = await tryRpc("WebServer.SetDefaultPage", { default_page: `/~${APP}/index.html` });
    console.log(ok !== null ? `[5/5] PLC default page set — https://${ip}/ now opens the dashboard`
                            : `[5/5] WebServer.SetDefaultPage failed — set it in TIA (Web server → entry page) if wanted`);
  } else {
    console.log(`[5/5] skipped PLC default page (pass --set-plc-default to enable)`);
  }
  console.log(`\nDONE. Open https://${ip}/~${APP}/ (accept the self-signed cert once) and log in.`);
} catch (e) {
  console.error(`DEPLOY FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (token) await rpc("Api.Logout", {}).catch(() => {});
}
