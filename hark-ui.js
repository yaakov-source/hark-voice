/* Hark Voice UI kit (app/hark-ui.js): circular controls, the input meter (v2.2: wide glass strip), the stats gauges and the small
 * DSP helpers the stats readout uses. No dependencies. Everything here is round: knobs, switches and
 * option dots. Exposes window.HarkUI. */
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var SWEEP = 135; // knobs and gauges sweep -135deg .. +135deg (0 = straight up)
  var uid = 0;

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function svg(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function polar(cx, cy, r, deg) { var a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arcPath(cx, cy, r, a0, a1) {
    if (a1 - a0 < 0.01) a1 = a0 + 0.01;
    var p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    return "M" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A" + r + " " + r + " 0 " + (a1 - a0 > 180 ? 1 : 0) + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2);
  }
  function decimals(step) { var s = String(step); var i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; }

  /* ---------- Knob: role=slider, drag (vertical or horizontal), arrows, PageUp/Down, Home/End, double-tap reset ---------- */
  function knob(o) {
    var id = "hk" + (++uid);
    var min = o.min, max = o.max, step = o.step || 0.01, def = o.def != null ? o.def : min;
    var value = clamp(o.value != null ? o.value : def, min, max);
    var fmt = o.format || function (v) { return v.toFixed(decimals(step)); };
    var root = el("div", "knob");
    var dial = el("div", "knob__dial", { role: "slider", tabindex: "0", "aria-label": o.label, "aria-valuemin": String(min), "aria-valuemax": String(max), id: id });
    var face = svg("svg", { viewBox: "0 0 100 100", "aria-hidden": "true", class: "knob__svg" });
    for (var i = 0; i <= 26; i++) {
      var a = -SWEEP + (i * 2 * SWEEP) / 26, major = i % 13 === 0, p0 = polar(50, 50, major ? 41 : 43.5, a), p1 = polar(50, 50, 47.5, a);
      face.appendChild(svg("line", { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], class: major ? "tick tick--major" : "tick" }));
    }
    face.appendChild(svg("path", { d: arcPath(50, 50, 38, -SWEEP, SWEEP), class: "knob__track" }));
    var arc = svg("path", { d: "", class: "knob__arc" });
    face.appendChild(arc);
    var cap = el("span", "knob__cap", { "aria-hidden": "true" });
    var ptr = el("span", "knob__ptr");
    cap.appendChild(ptr);
    dial.appendChild(face); dial.appendChild(cap);
    var val = el("span", "knob__val", { "aria-hidden": "true" });
    var lab = el("label", "knob__label", { for: id });
    lab.textContent = o.label;
    root.appendChild(dial); root.appendChild(val); root.appendChild(lab);
    if (o.hint) { var h = el("span", "knob__hint"); h.textContent = o.hint; root.appendChild(h); }

    function frac(v) { return (v - min) / (max - min); }
    function paint() {
      var ang = -SWEEP + frac(value) * 2 * SWEEP;
      var from = o.center != null ? -SWEEP + frac(o.center) * 2 * SWEEP : -SWEEP;
      arc.setAttribute("d", ang >= from ? arcPath(50, 50, 38, from, ang) : arcPath(50, 50, 38, ang, from));
      cap.style.transform = "rotate(" + ang.toFixed(1) + "deg)";
      var t = fmt(value);
      val.textContent = t;
      dial.setAttribute("aria-valuenow", String(+value.toFixed(6)));
      dial.setAttribute("aria-valuetext", t);
      root.toggleAttribute("data-default", Math.abs(value - def) < step / 2);
    }
    function snap(v) { v = Math.round((v - min) / step) * step + min; return +clamp(v, min, max).toFixed(6); }
    function setV(v, emit) {
      v = snap(v);
      if (v === value) return;
      value = v; paint();
      if (emit && o.onInput) o.onInput(value);
    }
    function commit() { if (o.onChange) o.onChange(value); }
    dial.addEventListener("keydown", function (e) {
      var big = (max - min) / 10, k = e.key, nv = null;
      if (k === "ArrowUp" || k === "ArrowRight") nv = value + step;
      else if (k === "ArrowDown" || k === "ArrowLeft") nv = value - step;
      else if (k === "PageUp") nv = value + big;
      else if (k === "PageDown") nv = value - big;
      else if (k === "Home") nv = min;
      else if (k === "End") nv = max;
      if (nv == null) return;
      e.preventDefault(); setV(nv, true); commit();
    });
    var drag = null, lastTap = 0;
    dial.addEventListener("pointerdown", function (e) {
      if (dial.getAttribute("aria-disabled") === "true") return;
      dial.focus({ preventScroll: true });
      try { dial.setPointerCapture(e.pointerId); } catch (x) {}
      drag = { x: e.clientX, y: e.clientY, v: value, id: e.pointerId, moved: false };
      e.preventDefault();
    });
    dial.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = (drag.y - e.clientY) + (e.clientX - drag.x) * 0.6;
      if (Math.abs(d) > 2) drag.moved = true;
      setV(drag.v + (d / 160) * (max - min), true);
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var moved = drag.moved; drag = null;
      if (!moved) { var now = Date.now(); if (now - lastTap < 350) { setV(def, true); } lastTap = now; }
      commit();
    }
    dial.addEventListener("pointerup", end);
    dial.addEventListener("pointercancel", end);
    paint();
    return {
      el: root, dial: dial,
      get: function () { return value; },
      set: function (v) { value = snap(v); paint(); },
      disable: function (on) { dial.setAttribute("aria-disabled", on ? "true" : "false"); dial.tabIndex = on ? -1 : 0; root.classList.toggle("is-off", !!on); },
    };
  }

  /* ---------- Round switch: a circular rocker with a lamp, role=switch ---------- */
  function toggle(o) {
    var on = !!o.value;
    var root = el("div", "switch");
    var b = el("button", "switch__btn", { type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": o.label });
    b.appendChild(el("span", "switch__lamp", { "aria-hidden": "true" }));
    var t = el("span", "switch__text", { "aria-hidden": "true" });
    var name = el("span", "switch__name"); name.textContent = o.label;
    var state = el("span", "switch__state");
    t.appendChild(name); t.appendChild(state);
    if (o.hint) { var h = el("span", "switch__hint"); h.textContent = o.hint; t.appendChild(h); }
    root.appendChild(b); root.appendChild(t);
    function paint() { b.setAttribute("aria-checked", on ? "true" : "false"); state.textContent = on ? (o.onText || "On") : (o.offText || "Off"); }
    b.addEventListener("click", function () { on = !on; paint(); if (o.onChange) o.onChange(on); });
    t.addEventListener("click", function () { b.click(); });
    paint();
    return { el: root, get: function () { return on; }, set: function (v) { on = !!v; paint(); }, disable: function (d) { b.disabled = !!d; root.classList.toggle("is-off", !!d); } };
  }

  /* ---------- Option dots: a radiogroup of circles (optionally swatches), roving tabindex ---------- */
  function dots(o) {
    var value = o.value;
    var root = el("div", "dots" + (o.layout === "list" ? " dots--list" : ""), { role: "radiogroup", "aria-label": o.label });
    var items = [];
    function build(options) {
      root.textContent = "";
      items = options.map(function (opt) {
        var cell = el("div", "dot");
        var b = el("button", "dot__btn", { type: "button", role: "radio", "aria-checked": "false", "aria-label": opt.aria || opt.label, "data-value": opt.value });
        var face = el("span", "dot__face", { "aria-hidden": "true" });
        if (opt.swatch) { face.classList.add("dot__face--swatch"); face.style.background = "conic-gradient(" + opt.swatch.map(function (c, i, a) { return c + " " + (i * 360 / a.length) + "deg " + ((i + 1) * 360 / a.length) + "deg"; }).join(",") + ")"; }
        else if (opt.glyph) face.textContent = opt.glyph;
        b.appendChild(face);
        var lab = el("span", "dot__label", { "aria-hidden": "true" }); lab.textContent = opt.label;
        cell.appendChild(b); cell.appendChild(lab);
        if (opt.sub) { var s = el("span", "dot__sub", { "aria-hidden": "true" }); s.textContent = opt.sub; cell.appendChild(s); }
        lab.addEventListener("click", function () { b.click(); });
        b.addEventListener("click", function () { if (value === opt.value) return; value = opt.value; paint(); if (o.onChange) o.onChange(value); });
        b.addEventListener("keydown", function (e) {
          var idx = items.indexOf(b), n = items.length, j = null;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (idx + 1) % n;
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (idx - 1 + n) % n;
          if (j == null) return;
          e.preventDefault(); items[j].focus(); items[j].click();
        });
        root.appendChild(cell);
        return b;
      });
      paint();
    }
    function paint() {
      var any = false;
      items.forEach(function (b) { var on = b.getAttribute("data-value") === String(value); any = any || on; b.setAttribute("aria-checked", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; });
      if (!any && items[0]) items[0].tabIndex = 0;
    }
    build(o.options);
    return { el: root, get: function () { return value; }, set: function (v) { value = v; paint(); }, rebuild: function (opts, v) { if (v !== undefined) value = v; build(opts); } };
  }

  /* ---------- DSP helpers (stats only) ---------- */
  function rmsPeak(buf) {
    var s = 0, p = 0;
    for (var i = 0; i < buf.length; i++) { var v = buf[i]; s += v * v; var a = v < 0 ? -v : v; if (a > p) p = a; }
    return { rms: Math.sqrt(s / (buf.length || 1)), peak: p };
  }
  function dbfs(x) { return x > 1e-6 ? 20 * Math.log10(x) : -120; }
  // Normalised autocorrelation F0 estimate, 70-500 Hz. Returns 0 when unvoiced or too quiet.
  function pitch(buf, sr) {
    var n = buf.length;
    var minLag = Math.max(2, Math.floor(sr / 500)), maxLag = Math.min(Math.floor(sr / 70), Math.floor(n / 2));
    var w = n - maxLag, e0 = 0, i;
    for (i = 0; i < w; i++) e0 += buf[i] * buf[i];
    if (e0 / w < 1e-5) return 0;
    var best = 0, bestLag = 0, prev = 1, dipped = false, corr = new Float32Array(maxLag + 2);
    for (var lag = minLag; lag <= maxLag; lag++) {
      var c = 0, e1 = 0;
      for (i = 0; i < w; i++) { var b = buf[i + lag]; c += buf[i] * b; e1 += b * b; }
      var r = c / Math.sqrt(e0 * e1 + 1e-12);
      corr[lag] = r;
      if (!dipped && r < prev && r < 0.3) dipped = true;
      if (dipped && r > best) { best = r; bestLag = lag; }
      prev = r;
    }
    if (best < 0.6 || !bestLag) return 0;
    var y0 = corr[bestLag - 1] || best, y2 = corr[bestLag + 1] || best, den = y0 - 2 * best + y2;
    var shift = den ? 0.5 * (y0 - y2) / den : 0;
    return sr / (bestLag + clamp(shift, -0.5, 0.5));
  }
  // Spectral centroid in Hz from an analyser's raw byte spectrum (bin k = k * sr / fftSize).
  function centroid(bytes, sr, fftSize, minDb, maxDb) {
    var hz = sr / fftSize, num = 0, den = 0, range = maxDb - minDb;
    for (var k = 1; k < bytes.length; k++) {
      if (!bytes[k]) continue;
      var m = Math.pow(10, (minDb + (bytes[k] / 255) * range) / 20);
      num += k * hz * m; den += m;
    }
    return den > 0 ? num / den : 0;
  }

  /* ---------- Colours from the active palette ---------- */
  function palette() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { var x = cs.getPropertyValue(n).trim(); return x || d; }
    return { ink: v("--ink", "#f3f1ee"), muted: v("--muted", "#a9a5b3"), faint: v("--faint", "rgba(255,255,255,.16)"), accent: v("--accent", "#a88bff"), accent2: v("--accent2", "#fb3b3b"), enamel: v("--enamel", "#121017") };
  }
  function hexToRgb(h) {
    h = String(h).trim();
    var m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return [200, 200, 200];
    var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) { return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")"; }

  /* ---------- Input meter (v2.2): a wide glass-cockpit strip above the Talk cluster ----------
     A fine graticule, the live input trace (time domain, the line) with the agent's output as a dimmer second
     trace, a faint 40-band spectrum floor, and a horizontal VU bar with peak hold over a -60..0 dBFS scale.
     The static layer (graticule, track, ticks, labels) is cached and redrawn only on resize or palette change. */
  var DB_MIN = -60, SCALE = [-60, -48, -36, -24, -12, -6, 0];
  function Meter(canvas, opts) {
    this.c = canvas; this.g = canvas.getContext("2d"); this.bars = opts && opts.bars || 40;
    this.cols = palette(); this.w = 0; this.h = 0; this.dpr = 1; this.bezel = null; this.prevIn = null; this.prevOut = null; this.last = null;
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); if (self.last) self.draw(self.last); }).observe(canvas);
    this.resize();
  }
  Meter.prototype.resize = function () {
    var r = this.c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w === this.c.width && h === this.c.height && this.bezel) return;
    this.c.width = w; this.c.height = h; this.w = w; this.h = h; this.dpr = dpr; this.bezel = null;
  };
  Meter.prototype.setPalette = function () { this.cols = palette(); this.bezel = null; };
  Meter.prototype.geom = function () {
    var d = this.dpr, w = this.w, h = this.h;
    var x0 = 2 * d, x1 = w - 10 * d, barH = 4 * d;
    var labY = h - 3 * d, barY = h - 24 * d, plotY0 = 6 * d, plotY1 = barY - 7 * d;
    return { x0: x0, x1: x1, pw: x1 - x0, py0: plotY0, py1: plotY1, ph: plotY1 - plotY0, barY: barY, barH: barH, labY: labY, d: d };
  };
  function xOf(G, db) { return G.x0 + clamp((db - DB_MIN) / -DB_MIN, 0, 1) * G.pw; }
  Meter.prototype.drawBezel = function () {
    var w = this.w, h = this.h, cols = this.cols, G = this.geom(), d = G.d;
    var off = document.createElement("canvas"); off.width = w; off.height = h;
    var g = off.getContext("2d"), i, x, y;
    // graticule: 12 columns, 4 rows; the centre line a touch brighter; minor ticks along the plot's left edge
    g.strokeStyle = cols.faint; g.lineWidth = Math.max(1, 0.6 * d); g.globalAlpha = 0.55;
    for (i = 1; i < 12; i++) { x = Math.round(G.x0 + (i * G.pw) / 12) + 0.5; g.beginPath(); g.moveTo(x, G.py0); g.lineTo(x, G.py1); g.stroke(); }
    g.setLineDash([2 * d, 3 * d]);
    for (i = 1; i < 4; i++) { if (i === 2) continue; y = Math.round(G.py0 + (i * G.ph) / 4) + 0.5; g.beginPath(); g.moveTo(G.x0, y); g.lineTo(G.x1, y); g.stroke(); }
    g.setLineDash([]);
    g.globalAlpha = 0.9; y = Math.round(G.py0 + G.ph / 2) + 0.5;
    g.beginPath(); g.moveTo(G.x0, y); g.lineTo(G.x1, y); g.stroke();
    g.globalAlpha = 1;
    // plot frame: corner brackets only (glass-cockpit style), no full box
    var k = 6 * d; g.strokeStyle = cols.muted; g.globalAlpha = 0.55; g.lineWidth = Math.max(1, 0.8 * d);
    [[G.x0, G.py0, 1, 1], [G.x1, G.py0, -1, 1], [G.x0, G.py1, 1, -1], [G.x1, G.py1, -1, -1]].forEach(function (c) {
      g.beginPath(); g.moveTo(c[0] + c[2] * k, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * k); g.stroke();
    });
    g.globalAlpha = 1;
    // VU track + -6 dB zone
    g.fillStyle = cols.faint; g.globalAlpha = 0.6; g.fillRect(G.x0, G.barY, G.pw, G.barH);
    g.fillStyle = cols.accent2; g.globalAlpha = 0.35; g.fillRect(xOf(G, -6), G.barY, G.x1 - xOf(G, -6), G.barH);
    g.globalAlpha = 1;
    // scale: a tick every 3 dB, majors on the labelled values, mono labels under the bar
    for (var db = DB_MIN; db <= 0; db += 3) {
      var major = SCALE.indexOf(db) >= 0; x = Math.round(xOf(G, db)) + 0.5;
      g.strokeStyle = major ? cols.muted : cols.faint; g.lineWidth = Math.max(1, (major ? 1 : 0.7) * d);
      g.beginPath(); g.moveTo(x, G.barY + G.barH + 2 * d); g.lineTo(x, G.barY + G.barH + (major ? 6 : 4) * d); g.stroke();
    }
    g.fillStyle = cols.muted; g.font = "500 " + (9 * d) + "px ui-monospace, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace"; g.textBaseline = "alphabetic";
    SCALE.forEach(function (v, j) {
      g.textAlign = j === 0 ? "left" : j === SCALE.length - 1 ? "right" : "center";
      var tx = xOf(G, v) + (j === 0 ? -1 * d : j === SCALE.length - 1 ? 1 * d : 0);
      g.fillText(v === 0 ? "0" : String(v), tx, G.labY);
    });
    this.bezel = off;
  };
  // Map a time-domain buffer onto n points: a short moving average (anti-alias) and a soft clip.
  function trace(buf, n, gain, prev, keep) {
    var out = prev && prev.length === n ? prev : new Float32Array(n);
    if (!buf || !buf.length) { for (var z = 0; z < n; z++) out[z] *= keep; return out; }
    var len = buf.length, step = len / n, win = Math.max(1, Math.floor(step));
    for (var i = 0; i < n; i++) {
      var i0 = Math.floor(i * step), s = 0, c = 0;
      for (var j = i0; j < i0 + win && j < len; j++) { s += buf[j]; c++; }
      var v = Math.tanh((c ? s / c : 0) * gain);
      out[i] = keep ? out[i] * keep + v * (1 - keep) : v;
    }
    return out;
  }
  // s: { bands, db, peakDb, active, gate, muted, td (input time domain), tdOut (agent output), gain, reduced }
  Meter.prototype.draw = function (s) {
    this.last = s;
    if (!this.w) this.resize();
    if (!this.bezel) this.drawBezel();
    var g = this.g, w = this.w, h = this.h, cols = this.cols, G = this.geom(), d = G.d, n = this.bars, i, x, y;
    g.clearRect(0, 0, w, h);
    g.drawImage(this.bezel, 0, 0);
    var live = s.active && !s.muted, mid = G.py0 + G.ph / 2, amp = G.ph / 2 - 1.5 * d;
    // spectrum floor: faint columns rising from the plot floor
    if (live && s.bands) {
      var cw = G.pw / n; g.fillStyle = cols.accent; g.globalAlpha = 0.16;
      for (i = 0; i < n; i++) { var v = clamp(s.bands[i] || 0, 0, 1); if (v < 0.01) continue; var bh = v * G.ph * 0.9; g.fillRect(G.x0 + i * cw + cw * 0.2, G.py1 - bh, cw * 0.6, bh); }
      g.globalAlpha = 1;
    }
    var P = Math.max(32, Math.min(240, Math.round(G.pw / (2 * d)))), gain = (s.gain || 1.6) * 3.2, keep = s.reduced ? 0.6 : 0;
    g.lineJoin = "round"; g.lineCap = "round";
    // agent output: a dimmer second trace
    if (s.tdOut) {
      this.prevOut = trace(s.tdOut, P, gain * 0.7, this.prevOut, keep);
      g.strokeStyle = cols.accent2; g.globalAlpha = 0.5; g.lineWidth = 1 * d;
      g.beginPath(); for (i = 0; i < P; i++) { x = G.x0 + (i / (P - 1)) * G.pw; y = mid - this.prevOut[i] * amp * 0.9; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
      g.globalAlpha = 1;
    } else this.prevOut = null;
    // input trace: the line
    var tin = live ? s.td : null;
    this.prevIn = trace(tin, P, gain, this.prevIn, tin ? keep : 0);
    g.strokeStyle = live ? cols.accent : cols.muted; g.globalAlpha = live ? 1 : 0.45; g.lineWidth = (live ? 1.5 : 1) * d;
    if (live && !s.reduced) { g.shadowColor = cols.accent; g.shadowBlur = 6 * d; }
    g.beginPath(); for (i = 0; i < P; i++) { x = G.x0 + (i / (P - 1)) * G.pw; y = mid - this.prevIn[i] * amp; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
    g.shadowBlur = 0; g.globalAlpha = 1;
    // VU bar + peak hold
    if (s.active) {
      var xl = xOf(G, s.db), xp = xOf(G, s.peakDb);
      if (s.db > DB_MIN) { g.fillStyle = s.muted ? cols.muted : cols.accent; g.fillRect(G.x0, G.barY, xl - G.x0, G.barH); }
      if (s.db > -6) { g.fillStyle = cols.accent2; g.fillRect(xOf(G, -6), G.barY, xl - xOf(G, -6), G.barH); }
      if (s.peakDb > DB_MIN) { g.fillStyle = s.gate ? cols.ink : cols.accent2; g.fillRect(Math.round(xp - d), G.barY - 2 * d, 2 * d, G.barH + 4 * d); }
    }
  };

  /* ---------- Stats gauge: 96px dial with needle, ticks, peak and a mono value ---------- */
  function gauge(canvas, frac, peak, text, cols) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), css = canvas.clientWidth || 96, px = Math.round(css * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    var g = canvas.getContext("2d"), w = px, R = w / 2, c = w / 2, d = dpr;
    g.clearRect(0, 0, w, w);
    g.lineCap = "round";
    for (var i = 0; i <= 20; i++) {
      var a = (-SWEEP + i * 2 * SWEEP / 20 - 90) * Math.PI / 180, major = i % 5 === 0;
      g.strokeStyle = major ? cols.muted : cols.faint; g.lineWidth = (major ? 1.3 : 1) * d;
      var r0 = R * (major ? 0.74 : 0.8);
      g.beginPath(); g.moveTo(c + r0 * Math.cos(a), c + r0 * Math.sin(a)); g.lineTo(c + R * 0.9 * Math.cos(a), c + R * 0.9 * Math.sin(a)); g.stroke();
    }
    g.strokeStyle = cols.faint; g.lineWidth = 1 * d; g.beginPath(); g.arc(c, c, R * 0.97, 0, Math.PI * 2); g.stroke();
    var f = clamp(frac || 0, 0, 1);
    g.strokeStyle = cols.accent; g.lineWidth = 2.4 * d;
    g.beginPath(); g.arc(c, c, R * 0.66, (-SWEEP - 90) * Math.PI / 180, (-SWEEP + f * 2 * SWEEP - 90) * Math.PI / 180); g.stroke();
    if (peak != null && peak > 0) {
      var ap = (-SWEEP + clamp(peak, 0, 1) * 2 * SWEEP - 90) * Math.PI / 180;
      g.strokeStyle = cols.accent2; g.lineWidth = 2 * d;
      g.beginPath(); g.moveTo(c + R * 0.7 * Math.cos(ap), c + R * 0.7 * Math.sin(ap)); g.lineTo(c + R * 0.92 * Math.cos(ap), c + R * 0.92 * Math.sin(ap)); g.stroke();
    }
    var an = (-SWEEP + f * 2 * SWEEP - 90) * Math.PI / 180;
    g.strokeStyle = cols.ink; g.lineWidth = 1.6 * d;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + R * 0.78 * Math.cos(an), c + R * 0.78 * Math.sin(an)); g.stroke();
    g.fillStyle = cols.ink; g.beginPath(); g.arc(c, c, 3 * d, 0, Math.PI * 2); g.fill();
    g.fillStyle = cols.ink; g.font = "500 " + Math.round(11 * d) + "px ui-monospace, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c, c + R * 0.62);
  }

  window.HarkUI = { knob: knob, toggle: toggle, dots: dots, Meter: Meter, gauge: gauge, palette: palette, rmsPeak: rmsPeak, dbfs: dbfs, pitch: pitch, centroid: centroid, clamp: clamp };
})();
