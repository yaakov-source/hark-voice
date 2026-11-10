/* Hark Voice UI kit (app/hark-ui.js): circular controls, the input meter, the stats gauges and the small
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

  /* ---------- Input meter: radial spectrum dial + 270deg VU arc with peak hold, around the Talk button ---------- */
  function Meter(canvas, opts) {
    this.c = canvas; this.g = canvas.getContext("2d"); this.bars = opts && opts.bars || 40;
    this.cols = palette(); this.w = 0; this.h = 0; this.dpr = 1; this.bezel = null;
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    this.resize();
  }
  Meter.prototype.resize = function () {
    var r = this.c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w === this.c.width && h === this.c.height && this.bezel) return;
    this.c.width = w; this.c.height = h; this.w = w; this.h = h; this.dpr = dpr; this.bezel = null;
  };
  Meter.prototype.setPalette = function () { this.cols = palette(); this.bezel = null; };
  /* v2.1: a fine instrument ring around a 68px cap. Radii are fractions of R so the ring scales with the canvas;
     the cap edge sits at ~0.61 R. Hairline strokes, 60 engraved ticks, a 1px VU track. */
  Meter.prototype.drawBezel = function () {
    var w = this.w, h = this.h, R = Math.min(w, h) / 2, cx = w / 2, cy = h / 2, d = this.dpr, cols = this.cols;
    var off = document.createElement("canvas"); off.width = w; off.height = h;
    var g = off.getContext("2d");
    g.lineCap = "butt";
    // engraved bezel ticks over the 270deg sweep only (the bottom gap carries the source label), long every 45deg
    var nT = 54;
    for (var i = 0; i <= nT; i++) {
      var deg = -SWEEP + (i * 2 * SWEEP) / nT, a = (deg - 90) * Math.PI / 180, long = i % 9 === 0;
      var r0 = R * (long ? 0.925 : 0.95), r1 = R * 0.99;
      g.strokeStyle = long ? cols.muted : cols.faint; g.lineWidth = (long ? 1 : 0.75) * d;
      g.beginPath(); g.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); g.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); g.stroke();
    }
    // VU arc track (hairline)
    g.strokeStyle = cols.faint; g.lineWidth = 0.9 * d;
    g.beginPath(); g.arc(cx, cy, R * 0.885, (-SWEEP - 90) * Math.PI / 180, (SWEEP - 90) * Math.PI / 180); g.stroke();
    // -6 dB and up: a short accent2 segment on the track (the red zone)
    var fz = (-6 + 60) / 60;
    g.strokeStyle = cols.accent2; g.globalAlpha = 0.75; g.lineWidth = 0.9 * d;
    g.beginPath(); g.arc(cx, cy, R * 0.885, (-SWEEP + fz * 2 * SWEEP - 90) * Math.PI / 180, (SWEEP - 90) * Math.PI / 180); g.stroke();
    g.globalAlpha = 1;
    this.bezel = off;
  };
  // s: { bands:Float32Array(0..1), db, peakDb, active, gate, muted }
  Meter.prototype.draw = function (s) {
    if (!this.w) this.resize();
    if (!this.bezel) this.drawBezel();
    var g = this.g, w = this.w, h = this.h, R = Math.min(w, h) / 2, cx = w / 2, cy = h / 2, d = this.dpr, cols = this.cols;
    g.clearRect(0, 0, w, h);
    g.drawImage(this.bezel, 0, 0);
    var A = hexToRgb(cols.accent), B = hexToRgb(cols.accent2), n = this.bars;
    g.lineCap = "round";
    // spectrum: short radial hairlines between the cap and the VU track
    var r0 = R * 0.72, r1 = R * 0.85, span = r1 - r0;
    var lw = Math.max(1 * d, (Math.PI * 2 * r0 * (270 / 360)) / n * 0.3);
    for (var i = 0; i < n; i++) {
      var f = n > 1 ? i / (n - 1) : 0, deg = -SWEEP + f * 2 * SWEEP, a = (deg - 90) * Math.PI / 180;
      var v = s.bands ? s.bands[i] || 0 : 0;
      if (s.muted) v = 0;
      var live = s.active && !s.muted;
      var len = Math.max(span * 0.08, span * clamp(v, 0, 1));
      g.strokeStyle = live ? mix(A, B, f) : cols.faint;
      g.globalAlpha = live ? 0.4 + 0.6 * clamp(v * 1.4, 0, 1) : 0.7;
      g.lineWidth = lw;
      g.beginPath(); g.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); g.lineTo(cx + (r0 + len) * Math.cos(a), cy + (r0 + len) * Math.sin(a)); g.stroke();
    }
    g.globalAlpha = 1;
    // VU level arc + peak hold
    if (s.active) {
      var fl = clamp((s.db + 60) / 60, 0, 1), fp = clamp((s.peakDb + 60) / 60, 0, 1);
      var a0 = (-SWEEP - 90) * Math.PI / 180, a1 = (-SWEEP + fl * 2 * SWEEP - 90) * Math.PI / 180;
      if (fl > 0.002) { g.strokeStyle = s.muted ? cols.muted : cols.accent; g.lineWidth = 1.6 * d; g.beginPath(); g.arc(cx, cy, R * 0.885, a0, a1); g.stroke(); }
      if (fp > 0.002) {
        var ap = (-SWEEP + fp * 2 * SWEEP - 90) * Math.PI / 180;
        g.strokeStyle = cols.accent2; g.lineWidth = 1.2 * d;
        g.beginPath(); g.moveTo(cx + R * 0.86 * Math.cos(ap), cy + R * 0.86 * Math.sin(ap)); g.lineTo(cx + R * 0.91 * Math.cos(ap), cy + R * 0.91 * Math.sin(ap)); g.stroke();
      }
      // needle tip riding the bezel
      var an = (-SWEEP + fl * 2 * SWEEP - 90) * Math.PI / 180;
      g.fillStyle = s.gate ? cols.accent2 : cols.ink;
      g.beginPath(); g.arc(cx + R * 0.955 * Math.cos(an), cy + R * 0.955 * Math.sin(an), 1.5 * d, 0, Math.PI * 2); g.fill();
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
