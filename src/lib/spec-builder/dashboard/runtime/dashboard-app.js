// src/lib/spec-builder/dashboard/runtime/dashboard-app.js
//
// Vanilla renderer for the generated commissioning dashboard. Plain browser
// script (no ES modules, no bundler) — attaches `window.DashApp`. Consumes
// `window.__DASH_MODEL__` (emitted by dashboard-emit.ts as dash-model.js)
// and reads/writes tags via `window.PlcTransport` (plc-transport.js).
//
// `stateLabel`, `activeAlarms` and `simStep` are pure state→view/decision
// helpers with NO `document` dependency, so they can be exercised outside a
// browser (see __tests__/dashboard-app.test.ts, which loads this file with a
// `window` that has no `document`).
(function (window) {
  "use strict";
  var doc = window.document;

  function stateLabel(em, values) {
    var idx = values[em.stateTag];
    if (typeof idx !== "number") return "—";
    var s = em.states.find(function (st) { return st.index === idx; });
    return s ? s.name : "#" + idx;
  }
  function activeAlarms(alarms, values) {
    return alarms.filter(function (a) {
      var v = values[a.tag];
      if (v == null) return false;
      return a.trigger === "hi" ? v === true : v === false;
    });
  }

  /**
   * Decide what the sim engine should write this tick.
   *
   * Healthy behaviour: a command going active starts a timer; once `delayMs`
   * has elapsed the feedback is driven active. Command clearing drops the
   * feedback immediately and cancels any pending timer. This is what stops
   * state machines stalling on feedback that no physical device will ever
   * send — PLCSIM accepts writes to %I with no hardware config.
   *
   * Pure: takes the clock, returns the writes and the next pending map. The
   * caller owns all IO, so the whole engine is testable with plain objects.
   */
  function simStep(rules, values, pending, now) {
    var writes = [];
    var next = {};
    rules.forEach(function (r) {
      var triggered = values[r.triggerTag] === r.triggerValue;
      var responded = values[r.responseTag] === r.responseValue;
      if (!triggered) {
        // Command gone — retract the feedback so the next cycle starts clean.
        if (responded) {
          writes.push({ tag: r.responseTag, value: typeof r.responseValue === "boolean" ? false : 0, type: r.responseType });
        }
        return;
      }
      if (responded) return; // already satisfied, nothing to do
      var due = pending[r.responseTag];
      if (due == null) { next[r.responseTag] = now + r.delayMs; return; }
      if (now >= due) writes.push({ tag: r.responseTag, value: r.responseValue, type: r.responseType });
      else next[r.responseTag] = due;
    });
    return { writes: writes, pending: next };
  }

  /**
   * Live status of one device, for the mimic tile.
   *
   * Precedence is deliberate: a fault outranks everything (a running motor with
   * a tripped overload is faulted, not running), a feedback means it is actually
   * moving, and a command with no feedback yet is in transition — which is the
   * state operators most need to see, because it is where a plant hangs.
   *
   * Roles come from the model, so this never inspects tag text.
   */
  /**
   * A device you can command is an actuator; one you can only read is an
   * instrument. The distinction matters because "Stopped" is meaningless for a
   * pressure transmitter — an operator seeing a healthy PT labelled STOPPED
   * stops trusting the screen.
   */
  function deviceKind(device) {
    return (device.commands || []).length > 0 ? "actuator" : "instrument";
  }

  function deviceStatus(device, values) {
    var sigs = device.signals || [];
    function anyTrue(role) {
      return sigs.some(function (s) { return s.role === role && values[s.id] === true; });
    }
    if (anyTrue("fault")) return "fault";

    var known = sigs.some(function (s) { return values[s.id] != null; });
    if (!known) return "unknown";

    // Instruments report health, not motion: they are live or they are not.
    if (deviceKind(device) === "instrument") return "ok";

    if (anyTrue("feedback")) return "running";
    var commanded = (device.commands || []).some(function (c) { return values[c.tag] === true; });
    if (commanded) return "starting";
    return "stopped";
  }

  var STATUS_LABEL = {
    fault: "Faulted", running: "Running", starting: "Starting", stopped: "Stopped",
    ok: "", unknown: "No data",
  };

  /** A value is "on" when a bool is true or a number is non-zero. */
  function isOn(v) {
    if (v === true) return true;
    if (typeof v === "number") return v !== 0;
    return false;
  }

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmt(v) { return v == null ? "—" : String(v); }

  var IO_GROUPS = [
    { key: "DI", title: "Digital Inputs" },
    { key: "DO", title: "Digital Outputs" },
    { key: "AI", title: "Analog Inputs" },
    { key: "AO", title: "Analog Outputs" },
  ];

  function render(root, model, transport) {
    root.innerHTML = "";
    // Last polled snapshot — latch buttons toggle against the PLC's actual
    // value rather than a local guess that can drift out of step with it.
    var lastValues = {};

    // ---- header -----------------------------------------------------------
    var head = el("header", "dash-head");
    head.appendChild(el("h1", "dash-title", model.project.name));
    var status = el("div", "dash-status", "connecting…");
    head.appendChild(status);
    root.appendChild(head);

    // ---- sim arm ----------------------------------------------------------
    // Structurally absent unless the live transport is the bridge: auto-driving
    // feedbacks into a real PLC must be impossible, not merely discouraged.
    var simArmed = { on: false };
    if (transport.kind === "bridge" && model.simRules && model.simRules.length) {
      var simBar = el("div", "dash-simbar");
      var simBtn = el("button", "dash-sim-toggle", "Sim engine: OFF");
      simBtn.onclick = function () {
        simArmed.on = !simArmed.on;
        simBtn.textContent = "Sim engine: " + (simArmed.on ? "ON" : "OFF");
        simBtn.className = "dash-sim-toggle" + (simArmed.on ? " on" : "");
      };
      simBar.appendChild(simBtn);
      simBar.appendChild(el("span", "dash-sim-note",
        model.simRules.length + " device feedback rule(s) — drives feedbacks so sequences don't stall on missing IO"));
      root.appendChild(simBar);
    }

    // ---- nav --------------------------------------------------------------
    var pages = [
      { id: "overview", label: "Overview" },
      { id: "devices", label: "Devices" },
      { id: "io", label: "IO" },
      { id: "sequences", label: "Sequences" },
      { id: "alarms", label: "Alarms" },
    ];
    var nav = el("nav", "dash-nav");
    var panels = {};
    var tabs = {};
    function show(id) {
      pages.forEach(function (p) {
        panels[p.id].style.display = p.id === id ? "" : "none";
        tabs[p.id].className = "dash-tab" + (p.id === id ? " active" : "");
      });
    }
    pages.forEach(function (p) {
      var b = el("button", "dash-tab", p.label);
      b.onclick = function () { show(p.id); };
      tabs[p.id] = b;
      nav.appendChild(b);
    });
    root.appendChild(nav);

    // ---- overview (plant mimic) -------------------------------------------
    // Grouped Unit → EM so the page reads as the plant's ISA-88 layout rather
    // than a flat device list. This is the "mimic slot" from the design; the
    // auto-grid is the generic fill, hand-dressing can replace it per project.
    var ovWrap = el("section", "dash-overview");
    var summary = el("div", "dash-summary");
    ovWrap.appendChild(summary);

    // Schematic plant view. Falls back to the tile grid below if mimic.js is
    // absent, so the bundle still works if the mimic is stripped out.
    var mimicView = null;
    if (window.DashMimic) {
      var mimicBox = el("div", "dash-mimic");
      ovWrap.appendChild(mimicBox);
      mimicView = window.DashMimic.render(mimicBox, model);
    }
    var unitOrder = [];
    var byUnit = {};
    model.devices.forEach(function (d) {
      var u = d.unit || "Plant";
      var e = d.em || "";
      if (!byUnit[u]) { byUnit[u] = { emOrder: [], byEm: {} }; unitOrder.push(u); }
      if (!byUnit[u].byEm[e]) { byUnit[u].byEm[e] = []; byUnit[u].emOrder.push(e); }
      byUnit[u].byEm[e].push(d);
    });
    var emStateByName = {};
    unitOrder.forEach(function (u) {
      var uSec = el("div", "dash-unit");
      uSec.appendChild(el("div", "dash-unit-name", u));
      byUnit[u].emOrder.forEach(function (e) {
        var eSec = el("div", "dash-em-block");
        var head = el("div", "dash-em-head");
        head.appendChild(el("span", "dash-em-title", e));
        var chip = el("span", "dash-em-chip", "—");
        // Match the EM by name so the chip shows its live PackML state.
        var match = model.ems.filter(function (m) { return m.name === e; })[0];
        if (match) emStateByName[e] = { em: match, chip: chip };
        head.appendChild(chip);
        eSec.appendChild(head);
        var grid = el("div", "dash-mimic-grid");
        byUnit[u].byEm[e].forEach(function (d) {
          var tile = el("div", "dash-tile");
          tile.dataset.dev = d.id;
          tile.appendChild(el("div", "dash-tile-name", d.name));
          tile.appendChild(el("div", "dash-tile-type", d.deviceType));
          tile.appendChild(el("div", "dash-tile-state", "—"));
          grid.appendChild(tile);
        });
        eSec.appendChild(grid);
        uSec.appendChild(eSec);
      });
      ovWrap.appendChild(uSec);
    });
    panels.overview = ovWrap;
    root.appendChild(ovWrap);

    // ---- devices ----------------------------------------------------------
    var devWrap = el("section", "dash-devices");
    model.devices.forEach(function (d) {
      var card = el("div", "dash-card");
      card.appendChild(el("div", "dash-card-title", d.name));
      d.commands.forEach(function (c) {
        var btn = el("button", "dash-cmd", c.label);
        btn.onclick = function () {
          transport.write(c.tag, true, c.type);
          if (c.momentary) setTimeout(function () { transport.write(c.tag, false, c.type); }, 400);
        };
        card.appendChild(btn);
      });
      d.signals.forEach(function (s) {
        var row = el("div", "dash-sig");
        row.dataset.tag = s.id;
        row.appendChild(el("span", "dash-sig-label", s.label));
        row.appendChild(el("span", "dash-sig-val", "—"));
        card.appendChild(row);
      });
      devWrap.appendChild(card);
    });
    panels.devices = devWrap;
    root.appendChild(devWrap);

    // ---- IO ---------------------------------------------------------------
    // Absolute addresses are shown next to live values: that pairing is the
    // commissioning check that the spec's addressing matches the plugged cards.
    var ioWrap = el("section", "dash-io");
    var io = model.io || [];
    IO_GROUPS.forEach(function (g) {
      var rows = io.filter(function (p) { return p.signalType === g.key; });
      if (!rows.length) return;
      ioWrap.appendChild(el("h2", null, g.title + " (" + rows.length + ")"));
      var table = el("table", "dash-io-table");
      var thead = el("thead");
      var hr = el("tr");
      ["", "Tag", "Address", "Description", "Device", "Value"].forEach(function (h) {
        hr.appendChild(el("th", null, h));
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el("tbody");
      rows.forEach(function (p) {
        var tr = el("tr");
        tr.dataset.io = p.tag;
        var pillCell = el("td", "dash-pill-cell");
        pillCell.appendChild(el("span", "dash-pill"));
        tr.appendChild(pillCell);
        tr.appendChild(el("td", "mono", p.tag));
        tr.appendChild(el("td", "mono", p.address || "—"));
        tr.appendChild(el("td", null, p.label));
        tr.appendChild(el("td", "dim", p.deviceName));
        tr.appendChild(el("td", "mono dash-io-val", "—"));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      ioWrap.appendChild(table);
    });
    if (!io.length) ioWrap.appendChild(el("p", "dim", "No physical IO in this specification."));
    panels.io = ioWrap;
    root.appendChild(ioWrap);

    // ---- sequences --------------------------------------------------------
    var emWrap = el("section", "dash-ems");
    model.ems.forEach(function (em) {
      var card = el("div", "dash-em-card");
      var row = el("div", "dash-em");
      row.dataset.em = em.id;
      row.appendChild(el("span", "dash-em-name", em.name));
      row.appendChild(el("span", "dash-em-state", "—"));
      card.appendChild(row);

      // PackML command seam. `enable` is a latch — it must stay asserted for
      // the EM to act on anything — so it toggles; the rest pulse.
      if (em.commands && em.commands.length) {
        var bar = el("div", "dash-em-cmds");
        em.commands.forEach(function (c) {
          var btn = el("button", "dash-cmd sm" + (c.momentary ? "" : " latch"), c.label);
          if (!c.momentary) btn.dataset.latch = c.tag;
          btn.onclick = function () {
            if (c.momentary) {
              transport.write(c.tag, true, c.type);
              setTimeout(function () { transport.write(c.tag, false, c.type); }, 400);
            } else {
              // Toggle against the last polled value so the button reflects the PLC.
              transport.write(c.tag, !(lastValues[c.tag] === true), c.type);
            }
          };
          bar.appendChild(btn);
        });
        card.appendChild(bar);
      }
      emWrap.appendChild(card);
    });
    panels.sequences = emWrap;
    root.appendChild(emWrap);

    // ---- alarms -----------------------------------------------------------
    var alarmWrap = el("section", "dash-alarms");
    var alarmList = el("ul", "dash-alarm-list");
    alarmWrap.appendChild(alarmList);
    panels.alarms = alarmWrap;
    root.appendChild(alarmWrap);

    show("overview");

    return {
      simArmed: simArmed,
      update: function (values, connected) {
        lastValues = values;
        status.textContent = connected ? "connected · " + transport.kind : "disconnected";
        // Latch buttons show the live state of the pin they drive.
        model.ems.forEach(function (em) {
          (em.commands || []).forEach(function (c) {
            if (c.momentary) return;
            var b = emWrap.querySelector('[data-latch="' + c.tag + '"]');
            if (b) b.className = "dash-cmd sm latch" + (values[c.tag] === true ? " on" : "");
          });
        });
        model.devices.forEach(function (d) {
          d.signals.forEach(function (s) {
            var cell = devWrap.querySelector('.dash-sig[data-tag="' + s.id + '"] .dash-sig-val');
            if (cell) cell.textContent = fmt(values[s.id]);
          });
        });
        io.forEach(function (p) {
          var tr = ioWrap.querySelector('tr[data-io="' + p.tag + '"]');
          if (!tr) return;
          var cell = tr.querySelector(".dash-io-val");
          if (cell) cell.textContent = fmt(values[p.tag]);
          var pill = tr.querySelector(".dash-pill");
          if (pill) pill.className = "dash-pill" + (isOn(values[p.tag]) ? " on" : "");
        });

        // Mimic + tiles + EM chips — one status computation feeds all three.
        // Counters describe the PLANT, so they count actuators — instruments
        // are not "stopped" and would otherwise inflate that number badly.
        var counts = { fault: 0, running: 0, starting: 0, stopped: 0, ok: 0, unknown: 0 };
        var statuses = {};
        model.devices.forEach(function (d) {
          var st = deviceStatus(d, values);
          statuses[d.id] = st;
          counts[st]++;
          var tile = ovWrap.querySelector('.dash-tile[data-dev="' + d.id + '"]');
          if (!tile) return;
          tile.className = "dash-tile is-" + st;
          var lbl = tile.querySelector(".dash-tile-state");
          if (lbl) lbl.textContent = STATUS_LABEL[st];
        });
        if (mimicView) mimicView.update(statuses, values);
        Object.keys(emStateByName).forEach(function (name) {
          var entry = emStateByName[name];
          entry.chip.textContent = stateLabel(entry.em, values);
        });
        summary.innerHTML = "";
        [
          { k: "running", t: "Running" }, { k: "starting", t: "Starting" },
          { k: "stopped", t: "Stopped" }, { k: "fault", t: "Faulted" },
        ].forEach(function (c) {
          var box = el("span", "dash-count is-" + c.k);
          box.appendChild(el("strong", null, String(counts[c.k])));
          box.appendChild(el("span", null, " " + c.t));
          summary.appendChild(box);
        });
        var alarmCount = activeAlarms(model.alarms, values).length;
        var ab = el("span", "dash-count" + (alarmCount ? " is-fault" : ""));
        ab.appendChild(el("strong", null, String(alarmCount)));
        ab.appendChild(el("span", null, " Active alarms"));
        summary.appendChild(ab);
        model.ems.forEach(function (em) {
          var cell = emWrap.querySelector('.dash-em[data-em="' + em.id + '"] .dash-em-state');
          if (cell) cell.textContent = stateLabel(em, values);
        });
        alarmList.innerHTML = "";
        var active = activeAlarms(model.alarms, values);
        if (!active.length) alarmList.appendChild(el("li", "dim", "No active alarms."));
        active.forEach(function (a) {
          alarmList.appendChild(el("li", "dash-alarm dash-" + a.class.toLowerCase(), a.text));
        });
      },
    };
  }

  async function start(root, model, transport) {
    var view = render(root, model, transport);
    var pending = {};
    var rules = model.simRules || [];
    for (;;) {
      try {
        var values = await transport.read(model.readTags);
        view.update(values, true);
        // Sim engine — bridge transport only, and only while armed.
        if (view.simArmed.on && transport.kind === "bridge" && rules.length) {
          var step = simStep(rules, values, pending, Date.now());
          pending = step.pending;
          for (var i = 0; i < step.writes.length; i++) {
            var w = step.writes[i];
            try { await transport.write(w.tag, w.value, w.type); } catch (we) { /* keep polling */ }
          }
        }
      } catch (e) {
        view.update({}, false);
        await new Promise(function (r) { setTimeout(r, 2000); });
      }
      await new Promise(function (r) { setTimeout(r, 500); });
    }
  }

  window.DashApp = {
    render: render,
    start: start,
    stateLabel: stateLabel,
    activeAlarms: activeAlarms,
    simStep: simStep,
    deviceStatus: deviceStatus,
    deviceKind: deviceKind,
    isOn: isOn,
  };
})(typeof window !== "undefined" ? window : this);
