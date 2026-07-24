// src/lib/spec-builder/dashboard/runtime/plc-transport.js
//
// Dual-transport data layer for the generated commissioning dashboard.
// Plain browser script (no ES modules, no bundler) — attaches
// `window.PlcTransport = { create(kind, opts) }`. Runs as-is from
// file://, static hosting, or embedded in a PLC's Web Server.
//
// Two adapters:
//   - "bridge"  (sim): PacForge .NET bridge -> PLCSIM Advanced, explicit
//     data_type per tag, unquoted tag names.
//   - "webapi"  (real PLC): Siemens S7-1500 Web API JSON-RPC
//     (PlcProgram.Read/Write), quoted SCL names, session token.
(function (window) {
  "use strict";

  function stripQuotes(tag) { return String(tag).replace(/"/g, ""); }
  // "DB.member" -> "\"DB\".\"member\"" ; "M01_Run" -> "\"M01_Run\""
  function plcVar(id) {
    var i = String(id).indexOf(".");
    return i < 0 ? '"' + id + '"' : '"' + id.slice(0, i) + '"."' + id.slice(i + 1) + '"';
  }

  function bridgeAdapter(opts) {
    var f = opts.fetch || window.fetch.bind(window);
    var base = opts.baseUrl || "http://localhost:5102";
    return {
      kind: "bridge",
      read: async function (tags) {
        var body = tags.map(function (t) { return { tag_name: stripQuotes(t.id), data_type: t.type }; });
        var r = await f(base + "/tia/plcsim/read-tags", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        var j = await r.json();
        var out = {};
        (j.values || []).forEach(function (v) { out[v.tag_name] = v.error ? null : v.value; });
        // map back to requested ids (bridge echoes unquoted names)
        var res = {};
        tags.forEach(function (t) { res[t.id] = (stripQuotes(t.id) in out) ? out[stripQuotes(t.id)] : null; });
        return res;
      },
      write: async function (tag, value, type) {
        var r = await f(base + "/tia/plcsim/write-tag", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: stripQuotes(tag), value: value, data_type: type }),
        });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || "write failed");
      },
    };
  }

  function webapiAdapter(opts) {
    var f = opts.fetch || window.fetch.bind(window);
    var base = opts.baseUrl || "";
    var token = opts.token || null;
    var id = 0;
    function rpc(method, params) {
      return f(base + "/api/jsonrpc", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, token ? { "X-Auth-Token": token } : {}),
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: method, params: params }),
      }).then(function (r) { return r.json(); });
    }
    return {
      kind: "webapi",
      setToken: function (t) { token = t; },
      read: async function (tags) {
        var batch = tags.map(function (t, i) {
          return { jsonrpc: "2.0", id: i + 1, method: "PlcProgram.Read", params: { var: plcVar(t.id), mode: "simple" } };
        });
        var r = await f(base + "/api/jsonrpc", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, token ? { "X-Auth-Token": token } : {}),
          body: JSON.stringify(batch),
        });
        var rows = await r.json();
        rows = Array.isArray(rows) ? rows : [rows];
        var byId = {};
        rows.forEach(function (row) { byId[row.id] = row; });
        var res = {};
        tags.forEach(function (t, i) { var row = byId[i + 1]; res[t.id] = row && !row.error ? row.result : null; });
        return res;
      },
      write: async function (tag, value, type) {
        var j = await rpc("PlcProgram.Write", { var: plcVar(tag), value: value, mode: "simple" });
        if (j.error) throw new Error(j.error.message || "write failed");
      },
      login: async function (user, password) {
        var j = await rpc("Api.Login", { user: user, password: password });
        if (j.error) throw new Error(j.error.message || "login failed");
        token = j.result.token; return token;
      },
    };
  }

  window.PlcTransport = {
    create: function (kind, opts) { return kind === "webapi" ? webapiAdapter(opts || {}) : bridgeAdapter(opts || {}); },
  };
})(typeof window !== "undefined" ? window : this);
