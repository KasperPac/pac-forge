// src/lib/spec-builder/dashboard/runtime/dashboard-app.js
//
// Vanilla renderer for the generated commissioning dashboard. Plain browser
// script (no ES modules, no bundler) — attaches `window.DashApp`. Consumes
// `window.__DASH_MODEL__` (emitted by dashboard-emit.ts as dash-model.js)
// and reads/writes tags via `window.PlcTransport` (plc-transport.js).
//
// `stateLabel` and `activeAlarms` are pure state→view helpers with NO
// `document` dependency, so they can be exercised outside a browser (see
// __tests__/dashboard-app.test.ts, which loads this file with a `window`
// that has no `document`).
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

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(root, model, transport) {
    root.innerHTML = "";
    root.appendChild(el("h1", "dash-title", model.project.name));
    var status = el("div", "dash-status", "connecting…");
    root.appendChild(status);

    // Devices
    var devWrap = el("section", "dash-devices");
    devWrap.appendChild(el("h2", null, "Devices"));
    model.devices.forEach(function (d) {
      var card = el("div", "dash-card");
      card.appendChild(el("div", "dash-card-title", d.name + " (" + d.tag + ")"));
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
    root.appendChild(devWrap);

    // EMs
    var emWrap = el("section", "dash-ems");
    emWrap.appendChild(el("h2", null, "Sequences"));
    model.ems.forEach(function (em) {
      var row = el("div", "dash-em");
      row.dataset.em = em.id;
      row.appendChild(el("span", "dash-em-name", em.name));
      row.appendChild(el("span", "dash-em-state", "—"));
      emWrap.appendChild(row);
    });
    root.appendChild(emWrap);

    // Alarms
    var alarmWrap = el("section", "dash-alarms");
    alarmWrap.appendChild(el("h2", null, "Alarms"));
    var alarmList = el("ul", "dash-alarm-list");
    alarmWrap.appendChild(alarmList);
    root.appendChild(alarmWrap);

    return {
      update: function (values, connected) {
        status.textContent = connected ? "connected · " + transport.kind : "disconnected";
        model.devices.forEach(function (d) {
          d.signals.forEach(function (s) {
            var row = devWrap.querySelector('.dash-sig[data-tag="' + s.id + '"] .dash-sig-val');
            if (row) row.textContent = values[s.id] == null ? "—" : String(values[s.id]);
          });
        });
        model.ems.forEach(function (em) {
          var cell = emWrap.querySelector('.dash-em[data-em="' + em.id + '"] .dash-em-state');
          if (cell) cell.textContent = stateLabel(em, values);
        });
        alarmList.innerHTML = "";
        activeAlarms(model.alarms, values).forEach(function (a) {
          alarmList.appendChild(el("li", "dash-alarm dash-" + a.class.toLowerCase(), a.text));
        });
      },
    };
  }

  async function start(root, model, transport) {
    var view = render(root, model, transport);
    for (;;) {
      try {
        var values = await transport.read(model.readTags);
        view.update(values, true);
      } catch (e) {
        view.update({}, false);
        await new Promise(function (r) { setTimeout(r, 2000); });
      }
      await new Promise(function (r) { setTimeout(r, 500); });
    }
  }

  window.DashApp = { render: render, start: start, stateLabel: stateLabel, activeAlarms: activeAlarms };
})(typeof window !== "undefined" ? window : this);
