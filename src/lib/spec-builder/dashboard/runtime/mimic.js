// src/lib/spec-builder/dashboard/runtime/mimic.js
//
// Schematic plant mimic for the generated commissioning dashboard — an
// SVG P&ID-style view where each control module is drawn as its own symbol
// rather than a card, laid out as process flow.
//
// The FDS carries no geometry, so the layout is DERIVED: equipment modules
// become process stages left→right in hierarchy order, in-line equipment sits
// on the process line, and instruments hang off it on ISA-style lead lines.
// That is what makes this generic — a conveyor line, a filling station and a
// stamping cell all lay out from the same rules with no per-project drawing.
//
// Symbols are keyed off `control_module_class`, which the FDS already carries,
// so no tag text is ever parsed.
//
// `symbolFor` and `layout` are pure (no `document`), so both are exercised in
// __tests__/mimic.test.ts without a browser.
(function (window) {
  "use strict";
  var doc = window.document;
  var NS = "http://www.w3.org/2000/svg";

  /**
   * Device class → how to draw it.
   *  kind "inline"     — sits ON the process line (motors, valves, vessels)
   *  kind "instrument" — ISA bubble on a lead line off the process line
   * `code` is the ISA-style two-letter identifier shown in an instrument bubble.
   */
  var SYMBOLS = {
    motor:              { kind: "inline", shape: "motor",     code: "M"  },
    conveyor:           { kind: "inline", shape: "conveyor",  code: ""   },
    transporter:        { kind: "inline", shape: "conveyor",  code: ""   },
    valve:              { kind: "inline", shape: "valve",     code: ""   },
    hopper:             { kind: "inline", shape: "hopper",    code: ""   },
    filter:             { kind: "inline", shape: "filter",    code: ""   },
    dryer:              { kind: "inline", shape: "vessel",    code: "DR" },
    cooler:             { kind: "inline", shape: "vessel",    code: "CL" },
    sensor_pressure:    { kind: "instrument", shape: "bubble", code: "PT" },
    sensor_level:       { kind: "instrument", shape: "bubble", code: "LT" },
    sensor_temperature: { kind: "instrument", shape: "bubble", code: "TT" },
    sensor_flow:        { kind: "instrument", shape: "bubble", code: "FT" },
    sensor_weight:      { kind: "instrument", shape: "bubble", code: "WT" },
    sensor_position:    { kind: "instrument", shape: "bubble", code: "ZS" },
    transmitter:        { kind: "instrument", shape: "bubble", code: "XT" },
    indicator:          { kind: "instrument", shape: "bubble", code: "XI" },
    push_button:        { kind: "instrument", shape: "bubble", code: "HS" },
    emergency_stop:     { kind: "instrument", shape: "estop",  code: "ES" },
  };
  var DEFAULT_SYMBOL = { kind: "inline", shape: "box", code: "" };

  function symbolFor(deviceType) {
    return SYMBOLS[deviceType] || DEFAULT_SYMBOL;
  }

  /**
   * Device names are free text and routinely longer than a symbol is wide
   * ("Blower Discharge Pressure Transmitter PT02"), so they must be clipped or
   * neighbouring labels overlap into an unreadable smear. The full name stays
   * available as a tooltip.
   */
  function shortLabel(name, max) {
    var n = String(name || "");
    var lim = max || 16;
    return n.length <= lim ? n : n.slice(0, lim - 1).replace(/[\s\-_]+$/, "") + "…";
  }

  // Layout constants — one place, so the whole drawing rescales together.
  var GEO = {
    stageGap: 40, nodeW: 92, nodeH: 62, nodeGap: 18,
    lineY: 132, instY: 34, padX: 28, padTop: 30, laneH: 250, titleH: 22,
  };

  /**
   * Compute positions for every device. Pure — returns plain numbers so the
   * arithmetic can be asserted without rendering anything.
   *
   * Each unit is a lane; each EM within it is a stage along that lane. Inline
   * equipment is spaced along the process line, instruments are distributed
   * above it and joined by a lead line.
   */
  function layout(model) {
    var lanes = [];
    var order = [];
    var byUnit = {};
    (model.devices || []).forEach(function (d) {
      var u = d.unit || "Plant";
      if (!byUnit[u]) { byUnit[u] = { emOrder: [], byEm: {} }; order.push(u); }
      var e = d.em || "";
      if (!byUnit[u].byEm[e]) { byUnit[u].byEm[e] = []; byUnit[u].emOrder.push(e); }
      byUnit[u].byEm[e].push(d);
    });

    var maxW = 0;
    order.forEach(function (u, li) {
      var laneTop = GEO.padTop + li * GEO.laneH;
      var x = GEO.padX;
      var stages = [];
      byUnit[u].emOrder.forEach(function (e) {
        var devs = byUnit[u].byEm[e];
        var inline = devs.filter(function (d) { return symbolFor(d.deviceType).kind === "inline"; });
        var insts = devs.filter(function (d) { return symbolFor(d.deviceType).kind === "instrument"; });
        var cols = Math.max(inline.length, insts.length, 1);
        var stageW = cols * GEO.nodeW + (cols - 1) * GEO.nodeGap;
        var nodes = [];
        inline.forEach(function (d, i) {
          nodes.push({
            id: d.id, device: d, role: "inline", sym: symbolFor(d.deviceType),
            x: x + i * (GEO.nodeW + GEO.nodeGap), y: laneTop + GEO.lineY,
            w: GEO.nodeW, h: GEO.nodeH,
          });
        });
        insts.forEach(function (d, i) {
          nodes.push({
            id: d.id, device: d, role: "instrument", sym: symbolFor(d.deviceType),
            x: x + i * (GEO.nodeW + GEO.nodeGap), y: laneTop + GEO.instY,
            w: GEO.nodeW, h: GEO.nodeH,
          });
        });
        stages.push({ name: e, x: x, w: stageW, nodes: nodes });
        x += stageW + GEO.stageGap;
      });
      maxW = Math.max(maxW, x);
      lanes.push({
        unit: u, top: laneTop, stages: stages,
        lineY: laneTop + GEO.lineY + GEO.nodeH / 2,
        lineFrom: GEO.padX, lineTo: Math.max(GEO.padX, x - GEO.stageGap),
      });
    });

    return { lanes: lanes, width: maxW + GEO.padX, height: GEO.padTop + order.length * GEO.laneH, geo: GEO };
  }

  // ---- drawing ------------------------------------------------------------

  function svg(tag, attrs) {
    var e = doc.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function text(x, y, str, cls) {
    var t = svg("text", { x: x, y: y, class: cls || "mim-t" });
    t.textContent = str;
    return t;
  }

  /** Draw the body of one node; the group carries the status class. */
  function drawShape(g, n) {
    var w = n.w, h = n.h, cx = n.x + w / 2, cy = n.y + h / 2;
    var s = n.sym.shape;
    if (s === "motor") {
      g.appendChild(svg("circle", { cx: cx, cy: cy, r: 22, class: "mim-body" }));
      g.appendChild(text(cx, cy + 6, "M", "mim-glyph"));
    } else if (s === "valve") {
      // ISA bowtie
      g.appendChild(svg("path", {
        d: "M" + (cx - 22) + "," + (cy - 15) + " L" + (cx - 22) + "," + (cy + 15) +
           " L" + (cx + 22) + "," + (cy - 15) + " L" + (cx + 22) + "," + (cy + 15) + " Z",
        class: "mim-body",
      }));
    } else if (s === "hopper") {
      g.appendChild(svg("path", {
        d: "M" + (cx - 26) + "," + (cy - 20) + " L" + (cx + 26) + "," + (cy - 20) +
           " L" + (cx + 10) + "," + (cy + 20) + " L" + (cx - 10) + "," + (cy + 20) + " Z",
        class: "mim-body",
      }));
    } else if (s === "filter") {
      g.appendChild(svg("rect", { x: cx - 22, y: cy - 18, width: 44, height: 36, rx: 3, class: "mim-body" }));
      g.appendChild(svg("path", { d: "M" + (cx - 22) + "," + (cy + 18) + " L" + (cx + 22) + "," + (cy - 18), class: "mim-hatch" }));
    } else if (s === "conveyor") {
      g.appendChild(svg("rect", { x: cx - 30, y: cy - 8, width: 60, height: 16, rx: 8, class: "mim-body" }));
      [-18, 0, 18].forEach(function (dx) {
        g.appendChild(svg("circle", { cx: cx + dx, cy: cy + 14, r: 5, class: "mim-roller" }));
      });
    } else if (s === "vessel") {
      g.appendChild(svg("rect", { x: cx - 24, y: cy - 20, width: 48, height: 40, rx: 10, class: "mim-body" }));
      g.appendChild(text(cx, cy + 5, n.sym.code, "mim-glyph"));
    } else if (s === "estop") {
      g.appendChild(svg("circle", { cx: cx, cy: cy, r: 20, class: "mim-body mim-estop" }));
      g.appendChild(text(cx, cy + 5, "ES", "mim-glyph"));
    } else if (s === "bubble") {
      g.appendChild(svg("circle", { cx: cx, cy: cy, r: 21, class: "mim-body" }));
      g.appendChild(text(cx, cy - 2, n.sym.code, "mim-glyph-sm"));
      var val = text(cx, cy + 12, "—", "mim-val");
      val.setAttribute("data-val", n.id);
      g.appendChild(val);
    } else {
      g.appendChild(svg("rect", { x: cx - 26, y: cy - 20, width: 52, height: 40, rx: 4, class: "mim-body" }));
    }
  }

  function render(root, model) {
    root.innerHTML = "";
    var plan = layout(model);
    var s = svg("svg", {
      class: "mim-svg", viewBox: "0 0 " + plan.width + " " + plan.height,
      width: "100%", height: plan.height,
      // Left-align: the default xMidYMid centres the drawing and leaves a wide
      // empty margin whenever the container is wider than the plant.
      preserveAspectRatio: "xMinYMin meet",
    });

    plan.lanes.forEach(function (lane) {
      s.appendChild(text(GEO.padX, lane.top + 14, lane.unit, "mim-unit"));
      // process line through the lane
      s.appendChild(svg("line", {
        x1: lane.lineFrom, y1: lane.lineY, x2: lane.lineTo, y2: lane.lineY, class: "mim-line",
      }));
      lane.stages.forEach(function (st) {
        s.appendChild(text(st.x, lane.top + GEO.titleH + 12, st.name, "mim-stage"));
        st.nodes.forEach(function (n) {
          var g = svg("g", { class: "mim-node is-unknown", "data-dev": n.id });
          if (n.role === "instrument") {
            // ISA lead line: dashed from bubble down to the process line
            g.appendChild(svg("line", {
              x1: n.x + n.w / 2, y1: n.y + n.h / 2 + 21,
              x2: n.x + n.w / 2, y2: lane.lineY, class: "mim-lead",
            }));
          }
          drawShape(g, n);
          var lab = text(n.x + n.w / 2, n.y + n.h + 12, shortLabel(n.device.name), "mim-label");
          var tip = svg("title", {});
          tip.textContent = n.device.name;
          lab.appendChild(tip);
          g.appendChild(lab);
          var st2 = text(n.x + n.w / 2, n.y + n.h + 24, "", "mim-state");
          st2.setAttribute("data-state", n.id);
          g.appendChild(st2);
          s.appendChild(g);
        });
      });
    });

    root.appendChild(s);

    return {
      /** statuses: { deviceId: "running"|"fault"|... }, values: tag→value */
      update: function (statuses, values) {
        plan.lanes.forEach(function (lane) {
          lane.stages.forEach(function (st) {
            st.nodes.forEach(function (n) {
              var g = s.querySelector('.mim-node[data-dev="' + n.id + '"]');
              if (!g) return;
              var status = statuses[n.id] || "unknown";
              g.setAttribute("class", "mim-node is-" + status);
              var lbl = g.querySelector('[data-state="' + n.id + '"]');
              if (lbl) lbl.textContent = status === "unknown" ? "" : status;
              var vEl = g.querySelector('[data-val="' + n.id + '"]');
              if (vEl) {
                // instrument bubble shows its own live reading
                var v = null;
                (n.device.signals || []).forEach(function (sig) {
                  if (v == null && values[sig.id] != null && sig.role === "value") v = values[sig.id];
                });
                if (v == null) {
                  (n.device.signals || []).forEach(function (sig) {
                    if (v == null && values[sig.id] != null) v = values[sig.id];
                  });
                }
                vEl.textContent = v == null ? "—" : String(v);
              }
            });
          });
        });
      },
    };
  }

  window.DashMimic = { render: render, layout: layout, symbolFor: symbolFor, shortLabel: shortLabel };
})(typeof window !== "undefined" ? window : this);
