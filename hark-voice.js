/* Hark Voice controller (app/hark-voice.js), v2 "Mk II console".
 * Visual wiring is unchanged from v1 (Q8 v6 voice lane README):
 *   mount (window.Q8VoiceVisuals or 'q8-voice-visuals-ready'); Conversation.startSession resolves -> vv.attach(conv);
 *   every state change -> vv.setAgentState; setMicMuted -> vv.setMuted; onInterruption -> vv.interrupt();
 *   teardown -> vv.detach(); visibility -> vv.pause()/vv.resume().
 * New in v2: a settings console (persisted), our own circular input meter (canvas 2D) fed by the SDK's input
 * analyser during calls, by a mic test otherwise and by the take player while auditioning; the bundle's Wave is an
 * optional style; geek stats. During a call the page opens no microphone of its own: the SDK's session is the
 * only getUserMedia (the mic test is refused and stopped whenever a call is active or starting). */
(function () {
  "use strict";
  var UI = window.HarkUI;
  var AGENT_ID = "agent_9801m72z3174f3xrhjzj6de3kf8q";
  var LIBSAMPLERATE_PATH = "libsamplerate.worklet.js";
  var CONNECT_TIMEOUT = 15000;
  var STORE_KEY = "harkVoice.settings.v2";
  var MODEL = "eleven_v4_turbo", OUT_FORMAT = "pcm_44100";
  var DEV = (function () {
    try { var h = location.hostname; return !h || h === "localhost" || h === "127.0.0.1" || /[?&]vizdebug\b/.test(location.search); } catch (e) { return false; }
  })();

  /* Voices: existing library voices only (verified with GET /v1/voices/<id> on 2026-11-10). The first one is the
     agent's own primary voice; a default call sends no voice override at all. */
  var VOICES = [
    { id: "mQhzghH40d534S75Y4H6", label: "Cyndi \u2014 primary", sub: "Agent default" },
    { id: "GpZNDpPmH7yz5KSn6sLQ", label: "Hark (Her 3)", sub: "Alternative" },
    { id: "Y76W0bsNna1xsDYFFKFn", label: "Cyndi Design 1", sub: "Alternative" },
    { id: "FJUlKPuWxRpjiNQnheeA", label: "HAI COO", sub: "Alternative" },
  ];
  var PALETTES = [
    { id: "original", label: "Original", swatch: ["#a88bff", "#fb0001", "#121017"] },
    { id: "walnut", label: "Walnut & Brass", swatch: ["#e7a43c", "#f3e7cf", "#3b2a1c"] },
    { id: "atomic", label: "Atomic Teal", swatch: ["#3cc8b4", "#ff7a5c", "#0e1f1d"] },
    { id: "lunar", label: "Lunar Silver", swatch: ["#d5dce6", "#8fb6ff", "#24272c"] },
    { id: "infrared", label: "Infrared", swatch: ["#ff4a35", "#ffa24a", "#1c0909"] },
    { id: "moss", label: "Moss & Mustard", swatch: ["#d8a92f", "#9aae62", "#1a1d10"] },
  ];
  var DEFAULTS = {
    voice: { id: VOICES[0].id, stability: 0.65, similarity: 0.9, speed: 1.0 },
    visual: { palette: "original", background: "halo", motion: "speech", intensity: 1.0, wave: false, reduced: false },
    audio: { volume: 1.0, ec: true, ns: true, agc: true, sensitivity: 1.0 },
    resp: { meterGain: 1.6, smoothing: 0.72, gateOpen: 0.12, gateClose: 0.07, holdMs: 280, reactivity: 1.0 },
    source: { inputId: "", outputId: "" },
    stats: { on: false },
  };

  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), ui = $("voiceUI");
  var statusEl = $("statusText"), inputLine = $("inputLine"), inputText = $("inputText"), gpuEl = $("gpuNote"), micHelp = $("micHelp");
  var talkBtn = $("talkBtn"), talkLabel = $("talkLabel"), talkSub = $("talkSub"), muteBtn = $("muteBtn"), muteLabel = $("muteLabel");
  var talkWrap = $("talkWrap"), meterSrcEl = $("meterSrc"), pipDock = $("pipDock"), radialLayer = document.querySelector(".stage__radial");

  /* ---------- settings store ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) {
    var out = clone(base);
    if (over && typeof over === "object") for (var sec in out) if (over[sec] && typeof over[sec] === "object") for (var k in out[sec]) if (k in over[sec] && typeof over[sec][k] === typeof out[sec][k]) out[sec][k] = over[sec][k];
    return out;
  }
  function load() { try { return merge(DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || "null")); } catch (e) { return clone(DEFAULTS); } }
  var S = load();
  if (!VOICES.some(function (v) { return v.id === S.voice.id; })) S.voice.id = DEFAULTS.voice.id;
  if (!PALETTES.some(function (p) { return p.id === S.visual.palette; })) S.visual.palette = DEFAULTS.visual.palette;
  var saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); note("Saved on this device."); }
      catch (e) { note("Couldn't save settings in this browser."); }
    }, 150);
  }

  /* ---------- GPU note ---------- */
  var GPU_COPY = {
    failed: "Animated visuals are off: 3D graphics couldn't start in this browser. Voice still works.",
    lost: "Animated visuals are off: 3D graphics stopped; voice still works.",
    error: "Visuals unavailable for now. Voice still works.",
  };
  var gpuFailed = {};
  function gpuKind(status) {
    if (/context-lost/.test(status)) return "lost";
    if (/failed|unavailable/.test(status)) return "failed";
    if (/error/.test(status)) return "error";
    return null;
  }
  function gpuStatus(part, status) {
    if (part !== "scene" && part !== "pip") return;
    var k = gpuKind(status);
    if (k) gpuFailed[part] = k;
    else if (/running|ready|mounted|restored|idle|paused|still|webgl|live|off/.test(status)) delete gpuFailed[part];
    var kinds = Object.keys(gpuFailed).map(function (p) { return gpuFailed[p]; });
    var kind = kinds.indexOf("failed") >= 0 ? "failed" : kinds.indexOf("lost") >= 0 ? "lost" : kinds.indexOf("error") >= 0 ? "error" : null;
    if (kind) gpuEl.textContent = GPU_COPY[kind];
    gpuEl.hidden = !kind;
    ui.setAttribute("data-gpu", kind === "failed" ? "unavailable" : kind || "ok");
  }

  /* ---------- visuals (bundle) ---------- */
  var vv = null, vvBusy = null, remountTimer = 0;
  function vizOptions() {
    var o = {
      scene: $("q8-voice-scene"),
      motion: S.visual.motion, background: S.visual.background, pipInk: "gradient",
      gate: { open: S.resp.gateOpen, close: Math.min(S.resp.gateClose, S.resp.gateOpen), holdMs: S.resp.holdMs, gain: S.audio.sensitivity },
      onStatus: function (part, status, detail) {
        if (/failed|context-lost|unavailable/.test(status)) console.warn("[hark voice visuals]", part, status, detail || "");
        ui.setAttribute("data-vv-" + part, status);
        gpuStatus(part, String(status));
      },
    };
    if (S.visual.wave) o.pip = $("q8-voice-pip"); // Wave style: mount the PiP exactly as v1 did; otherwise never pass it
    return o;
  }
  function mountViz() {
    if (vv || vvBusy || !window.Q8VoiceVisuals) return;
    pipDock.hidden = !S.visual.wave;
    if (!S.visual.wave) delete gpuFailed.pip;
    try {
      vv = window.Q8VoiceVisuals.mount(vizOptions());
      restoreViz();
    } catch (e) { vv = null; console.warn("[hark voice visuals] mount failed", e); gpuStatus("scene", "failed"); }
  }
  // Re-attach whatever owned the visuals before a remount (live call, or the take player).
  function restoreViz() {
    if (!vv) return;
    if (ctl.conv && isLive(snap.state)) { vv.attach(ctl.conv); vv.setAgentState(snap.state); if (snap.muted) vv.setMuted(true); }
    else if (preview.attached) { vv.attach(adapter); vv.setAgentState(preview.playing ? "speaking" : "listening"); }
    else vv.setAgentState(snap.state);
    applyMotionHold();
  }
  // Remount after gate / sensitivity / Wave changes. Serialised and debounced; never touches the call itself.
  function remountViz(delay) {
    clearTimeout(remountTimer);
    remountTimer = setTimeout(function () {
      if (vvBusy) { remountViz(120); return; }
      var old = vv; vv = null;
      if (!old) { mountViz(); return; }
      var p;
      try { p = old.destroy(); } catch (e) { p = null; }
      vvBusy = Promise.resolve(p).catch(function () {}).then(function () { vvBusy = null; mountViz(); });
    }, delay == null ? 450 : delay);
  }
  function syncViz() {
    if (!vv) return;
    if (preview.attached) return; // the take player owns the agent state while it is attached
    vv.setAgentState(snap.state);
  }
  function applyMotionHold() {
    if (!vv) return;
    if (document.hidden || S.visual.reduced) vv.pause(); else vv.resume();
  }

  /* ---------- call state ---------- */
  var COPY = {
    idle: "Ready when you are",
    connecting: "Connecting",
    listening: "Listening",
    speaking: "Speaking",
    ended: "Ended",
    connect: "Couldn't connect. Check your connection and try again.",
    mic: "Microphone blocked. Allow it, then try again.",
    noMic: "No microphone found.",
    audio: "Audio was blocked. Tap Talk again.",
    lost: "Connection lost. Tap Talk again.",
    micFailed: "The microphone stopped responding. Try again.",
    unavailable: "Voice is unavailable right now.",
    signin: "Sign in required",
    secure: "Couldn't start a secure session",
  };
  var snap = { state: "idle", muted: false, canMute: false, error: "", micBlocked: false };
  var ctl = { epoch: 0, conv: null, connectTimer: 0, lastMode: "listening", lostEarly: false, cut: false, voiceAtStart: null };
  function isLive(s) { return s === "listening" || s === "speaking"; }
  function isActive(s) { return s === "connecting" || isLive(s); }

  function statusText(s) {
    switch (s.state) {
      case "connecting": return COPY.connecting;
      case "listening": return COPY.listening;
      case "speaking": return COPY.speaking;
      case "ended": return COPY.ended;
      case "error": return s.error || COPY.connect;
      default: return preview.playing ? "Playing " + preview.name : test.on ? "Mic test running" : COPY.idle;
    }
  }
  function inputState(s) {
    if (s.state === "connecting") return "Mic starting";
    if (isLive(s.state)) return s.muted ? "Muted" : "Mic on, listening";
    if (test.on) return "Mic test";
    return "Mic off";
  }
  function render() {
    var s = snap;
    stage.setAttribute("data-state", s.state);
    stage.setAttribute("data-speaking", s.state === "speaking" ? "true" : "false");
    stage.setAttribute("data-muted", isLive(s.state) && s.muted ? "true" : "false");
    var t = statusText(s); if (statusEl.textContent !== t) statusEl.textContent = t;
    var it = inputState(s); if (inputText.textContent !== it) inputText.textContent = it;
    inputLine.setAttribute("data-input", it === "Muted" ? "muted" : it === "Mic on, listening" || it === "Mic test" ? "listening" : it === "Mic starting" ? "starting" : "off");
    var active = isActive(s.state);
    talkLabel.textContent = active ? "End" : s.state === "ended" || s.state === "error" ? "Again" : "Talk";
    talkSub.textContent = active ? (s.state === "connecting" ? "connecting" : "the call") : "to Hark";
    talkBtn.setAttribute("aria-label", active ? "End the call with Hark" : "Talk to Hark");
    muteBtn.disabled = !isLive(s.state) || !s.canMute;
    muteBtn.setAttribute("aria-pressed", isLive(s.state) && s.muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", s.muted ? "Unmute microphone" : "Mute microphone");
    muteLabel.textContent = s.muted && isLive(s.state) ? "Unmute" : "Mute";
    micHelp.hidden = !s.micBlocked;
    takesEnabled(!active);
    syncCallBound();
  }
  function set(patch) {
    var changed = false;
    for (var k in patch) if (snap[k] !== patch[k]) { snap[k] = patch[k]; changed = true; }
    if (!changed) return;
    render();
    syncViz();
    wake(isActive(snap.state));
    kick();
  }

  /* ---------- stats bookkeeping ---------- */
  var st = {
    conn: "disconnected", startedAt: 0, convId: "", interrupts: 0, lat: [], lastLat: 0,
    lastVoiceAt: 0, agentStartAt: 0, vadAt: 0, inRate: 0, outRate: 0,
    inDb: -120, inPk: -120, inPkAt: 0, outDb: -120, outPk: -120, outPkAt: 0,
    f0In: 0, f0Out: 0, centIn: 0, centOut: 0, fps: 0, frames: 0, fpsAt: 0, gl: "", sw: "", online: navigator.onLine,
  };
  function resetCallStats() { st.startedAt = 0; st.convId = ""; st.interrupts = 0; st.lat = []; st.lastLat = 0; st.lastVoiceAt = 0; st.agentStartAt = 0; st.inRate = 0; st.outRate = 0; }
  function noteAgentStart() {
    var now = performance.now();
    if (st.lastVoiceAt && st.lastVoiceAt > st.agentStartAt && now - st.lastVoiceAt < 10000) {
      st.lastLat = now - st.lastVoiceAt; st.lat.push(st.lastLat); if (st.lat.length > 20) st.lat.shift();
    }
    st.agentStartAt = now;
  }

  /* ---------- session lifecycle ---------- */
  function endQuietly(c) {
    if (!c || typeof c.endSession !== "function") return;
    try { var r = c.endSession(); if (r && typeof r.then === "function") r.then(null, function () {}); } catch (e) {}
  }
  function teardown(next) {
    ctl.epoch++;
    var c = ctl.conv; ctl.conv = null;
    clearTimeout(ctl.connectTimer); ctl.connectTimer = 0;
    ctl.lastMode = "listening"; ctl.lostEarly = false; ctl.cut = false; ctl.voiceAtStart = null;
    st.conn = "disconnected";
    var to = next || { state: "idle" };
    try { endQuietly(c); } finally {
      try { if (vv && !preview.attached) vv.detach(); } catch (e) { if (DEV) console.warn("[hark] detach failed", e); }
      set({ state: to.state, error: to.error || "", muted: false, canMute: false, micBlocked: !!to.micBlocked });
    }
  }
  function isPlaybackBlocked(err) {
    var name = (err && err.name) || "", text = typeof err === "string" ? err : String((err && err.message) || "");
    var na = name === "NotAllowedError" || /NotAllowedError/.test(text);
    return na && /\bplay\b|play\(\)|autoplay|audiocontext|user gesture|didn't interact/i.test(text) && !/microphone|getusermedia|audio-capture/i.test(text);
  }
  function startError(err) {
    var name = err && err.name;
    if (isPlaybackBlocked(err)) return { state: "error", error: COPY.audio };
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return { state: "error", error: COPY.mic, micBlocked: true };
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return { state: "error", error: COPY.noMic };
    return { state: "error", error: COPY.connect };
  }
  // TTS overrides: only the values the user moved away from the defaults, so a default call uses the agent's own config.
  function ttsOverrides() {
    var d = DEFAULTS.voice, v = S.voice, t = {}, any = false;
    if (v.id !== d.id) { t.voiceId = v.id; any = true; }
    if (Math.abs(v.stability - d.stability) > 1e-6) { t.stability = v.stability; any = true; }
    if (Math.abs(v.similarity - d.similarity) > 1e-6) { t.similarityBoost = v.similarity; any = true; }
    if (Math.abs(v.speed - d.speed) > 1e-6) { t.speed = v.speed; any = true; }
    return any ? t : null;
  }

  function startCall() {
    if (ctl.conv || isActive(snap.state)) teardown();
    stopPreview(true); // never feed the radial from a take while a live call is attached
    stopTest();        // the SDK's session is the only microphone during a call
    var my = ++ctl.epoch;
    var current = function () { return my === ctl.epoch; };
    var guard = function (fn) { return function () { if (!current()) return; return fn.apply(null, arguments); }; };
    ctl.lastMode = "listening"; ctl.lostEarly = false; ctl.cut = false;
    resetCallStats(); st.conn = "connecting";
    set({ state: "connecting", muted: false, error: "", canMute: false, micBlocked: false });
    ctl.connectTimer = setTimeout(function () { if (current()) teardown({ state: "error", error: COPY.connect }); }, CONNECT_TIMEOUT);
    var tts = ttsOverrides();
    ctl.voiceAtStart = JSON.stringify(S.voice);
    Promise.all([loadSdk(), sessionAuth()]).then(function (res) {
      var Conversation = res[0], auth = res[1];
      if (!current()) return null;
      if (auth.signin) {
        // The auth gate answered 401: say so, then reload so the gate's sign-in page takes over.
        teardown({ state: "error", error: COPY.signin });
        setTimeout(function () { location.reload(); }, 1200);
        return null;
      }
      if (auth.error) { teardown({ state: "error", error: COPY.secure }); return null; }
      st.auth = auth.signedUrl ? "signed url" : "agent id";
      var opts = {
        connectionType: "websocket",
        libsampleratePath: LIBSAMPLERATE_PATH,
        onConnect: guard(function (info) { st.conn = "connected"; st.startedAt = Date.now(); if (info && info.conversationId) st.convId = info.conversationId; if (DEV) console.info("[hark] connected"); }),
        onStatusChange: guard(function (x) { var v = x && x.status ? x.status : x; if (v) st.conn = String(v); if (DEV) console.info("[hark] status", v); }),
        onVadScore: guard(function (x) { if (x && x.vadScore > 0.5 && snap.state !== "speaking") { st.lastVoiceAt = performance.now(); st.vadAt = st.lastVoiceAt; } }),
        onDisconnect: guard(function (details) {
          if (snap.state === "connecting") { ctl.lostEarly = true; return; }
          var reason = details && details.reason;
          if (reason === "agent" || reason === "user") teardown({ state: "ended" });
          else teardown({ state: "error", error: COPY.lost });
        }),
        onError: guard(function (message, context) {
          if (DEV) console.warn("[hark] session error", message, context);
          var named = context && context.name ? context : message && message.name ? message : null;
          var muteFailed = /muted state/i.test(typeof message === "string" ? message : String((message && message.message) || ""));
          if (muteFailed) return teardown({ state: "error", error: COPY.micFailed });
          if (isPlaybackBlocked(message) || isPlaybackBlocked(context)) return teardown({ state: "error", error: COPY.audio });
          if (snap.state === "connecting") return teardown(named ? startError(named) : { state: "error", error: COPY.connect });
          teardown({ state: "error", error: COPY.lost });
        }),
        onModeChange: guard(function (m) {
          var value = m && typeof m === "object" ? m.mode : m;
          var was = ctl.lastMode;
          ctl.lastMode = value === "speaking" ? "speaking" : "listening";
          if (ctl.lastMode === "speaking" && was !== "speaking") noteAgentStart();
          if (!isLive(snap.state)) return;
          if (ctl.lastMode === "speaking") { ctl.cut = false; set({ state: "speaking" }); }
          else set({ state: "listening" });
        }),
        onInterruption: guard(function () {
          ctl.cut = true; st.interrupts++;
          if (vv) vv.interrupt();
          if (snap.state === "speaking") set({ state: "listening" });
        }),
      };
      if (auth.signedUrl) opts.signedUrl = auth.signedUrl; else opts.agentId = AGENT_ID;
      if (tts) opts.overrides = { tts: tts };
      if (S.source.inputId) opts.inputDeviceId = S.source.inputId;
      if (S.source.outputId && sinkSupported()) opts.outputDeviceId = S.source.outputId;
      return Conversation.startSession(opts);
    }).then(function (c) {
      if (!c) return;
      if (!current()) { endQuietly(c); return; }
      clearTimeout(ctl.connectTimer); ctl.connectTimer = 0;
      ctl.conv = c;
      if (ctl.lostEarly) { teardown({ state: "error", error: COPY.lost }); return; }
      if (!st.startedAt) st.startedAt = Date.now();
      try { if (!st.convId && c.getId) st.convId = c.getId() || ""; } catch (e) {}
      try { if (S.audio.volume !== 1 && c.setVolume) c.setVolume({ volume: S.audio.volume }); } catch (e) {}
      set({ state: ctl.lastMode, canMute: typeof c.setMicMuted === "function", error: "" });
      if (ctl.lastMode === "speaking") noteAgentStart();
      if (vv) vv.attach(c);
      refreshDevices();
    }).catch(function (err) {
      if (!current()) return;
      if (DEV) console.warn("[hark] start failed", err);
      if (err && err.sdkLoadFailed) { teardown({ state: "error", error: COPY.unavailable }); return; }
      teardown(startError(err));
    });
  }
  /* v2.2: a private deploy puts an auth gate in front of the app and serves a short-lived ElevenLabs signed URL at
     ./api/hark-signed-url. 200 JSON {signed_url: "wss://..."} -> start with it. 401 -> "Sign in required", then reload
     so the gate's sign-in page takes over. Any other outcome (404, network error, timeout, non-JSON, no signed_url):
     only on the public GitHub Pages host may the call fall back to the public agentId; on every other host the
     signed URL is required and the call stops with "Couldn't start a secure session". Never cached (sw.js skips /api/). */
  var SIGNED_URL_PATH = "./api/hark-signed-url", SIGNED_URL_TIMEOUT = 5000, PUBLIC_HOST = "yaakov-source.github.io";
  function sessionAuth() {
    var fail = location.hostname === PUBLIC_HOST ? { agentId: AGENT_ID } : { error: true };
    if (!window.fetch) return Promise.resolve(fail);
    var ac = window.AbortController ? new AbortController() : null, timer = 0;
    var timeout = new Promise(function (resolve) { timer = setTimeout(function () { if (ac) ac.abort(); resolve(fail); }, SIGNED_URL_TIMEOUT); });
    var req = fetch(SIGNED_URL_PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: ac ? ac.signal : undefined })
      .then(function (r) {
        if (r.status === 401) return { signin: true };
        if (r.status !== 200) return fail;
        return r.text().then(function (t) {
          var j = null; try { j = JSON.parse(t); } catch (e) { return fail; }
          var u = j && typeof j.signed_url === "string" ? j.signed_url : "";
          return /^wss:\/\//.test(u) ? { signedUrl: u } : fail;
        });
      })
      .catch(function () { return fail; });
    return Promise.race([req, timeout]).then(function (a) { clearTimeout(timer); if (DEV) console.info("[hark] auth", a.signin ? "401" : a.signedUrl ? "signed url" : a.error ? "failed (no fallback on this host)" : "agent id"); return a; });
  }
  function endCall() {
    if (!isActive(snap.state) && !ctl.conv) return;
    teardown({ state: "ended" });
  }
  function setMuted(on) {
    var c = ctl.conv;
    if (!c || !isLive(snap.state) || !snap.canMute) return;
    try { c.setMicMuted(on); } catch (e) { teardown({ state: "error", error: COPY.micFailed }); return; }
    if (vv) vv.setMuted(on);
    set({ muted: on });
  }
  talkBtn.addEventListener("click", function () { if (isActive(snap.state)) endCall(); else startCall(); });
  muteBtn.addEventListener("click", function () { setMuted(!snap.muted); });

  /* ---------- SDK ---------- */
  var sdkPromise = null;
  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = new Promise(function (resolve) {
        if (window.ElevenLabsClient || document.readyState !== "loading") resolve();
        else document.addEventListener("DOMContentLoaded", function () { resolve(); }, { once: true });
      }).then(function () {
        var lib = window.ElevenLabsClient, C = lib && lib.Conversation;
        if (!C || typeof C.startSession !== "function") throw new Error("window.ElevenLabsClient.Conversation missing");
        return C;
      }).catch(function (e) {
        var err = new Error("SDK failed to load: " + (e && e.message)); err.sdkLoadFailed = true; sdkPromise = null; throw err;
      });
    }
    return sdkPromise;
  }
  function sdkAnalyser(side) { try { var c = ctl.conv, p = c && c[side]; return p && p.getAnalyser ? p.getAnalyser() : null; } catch (e) { return null; } }
  function sdkRate(side) { try { var c = ctl.conv, p = c && c[side]; return p && p.context ? p.context.sampleRate : 0; } catch (e) { return 0; } }

  /* ---------- wake lock ---------- */
  var lock = null;
  function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock && !document.hidden) navigator.wakeLock.request("screen").then(function (l) { lock = l; l.addEventListener("release", function () { lock = null; }); }, function () {});
      else if (!on && lock) { lock.release(); lock = null; }
    } catch (e) {}
  }

  /* ---------- spectrum layout helpers ---------- */
  var SDK_LO = 100, SDK_HI = 8000, BINS = 1024;
  // Resample a raw analyser spectrum onto the SDK's layout (1024 bins, linear 100-8000 Hz).
  function toSdkLayout(an, raw, out, sr) {
    an.getByteFrequencyData(raw);
    var hzPerBin = sr / an.fftSize, n = raw.length;
    for (var i = 0; i < BINS; i++) {
      var hz = SDK_LO + (i * (SDK_HI - SDK_LO)) / BINS, x = hz / hzPerBin, k = Math.floor(x), f = x - k;
      var a = k < n ? raw[k] : 0, b = k + 1 < n ? raw[k + 1] : 0;
      out[i] = Math.round(a + (b - a) * f);
    }
    return out;
  }
  function meanByte(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length / 255 : 0; }

  /* ---------- Voice takes: page-side adapter over an <audio> element (v1), plus output gain ---------- */
  var sheet = $("voicesSheet"), scrim = $("sheetScrim"), openBtn = $("voicesOpen"), closeBtn = $("voicesClose"), vnote = $("voicesNote");
  var audio = $("takeAudio");
  var takes = Array.prototype.slice.call(document.querySelectorAll(".take"));
  var preview = { attached: false, playing: false, name: "", settleTimer: 0 };
  var actx = null, analyser = null, gainNode = null, srcNode = null, rawBytes = null, outBytes = new Uint8Array(BINS), EMPTY = new Uint8Array(0);

  function ensureGraph() {
    if (actx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      actx = new AC();
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      gainNode = actx.createGain(); gainNode.gain.value = S.audio.volume;
      srcNode = actx.createMediaElementSource(audio);
      srcNode.connect(analyser); analyser.connect(gainNode); gainNode.connect(actx.destination); // visuals read pre-volume
      rawBytes = new Uint8Array(analyser.frequencyBinCount);
      return true;
    } catch (e) { console.warn("[hark] take analyser unavailable", e); actx = null; return false; }
  }
  function readBins() { if (!analyser) { outBytes.fill(0); return outBytes; } return toSdkLayout(analyser, rawBytes, outBytes, actx.sampleRate); }
  var adapter = {
    type: "voice",
    output: { analyser: { minDecibels: -100, maxDecibels: -30 } },
    getOutputVolume: function () { if (!preview.playing) return 0; return meanByte(readBins()); },
    getOutputByteFrequencyData: function () { if (!preview.playing) { outBytes.fill(0); return outBytes; } return readBins(); },
    getInputVolume: function () { return 0; },
    getInputByteFrequencyData: function () { return EMPTY; },
  };
  function syncAdapterRange() { if (analyser) { adapter.output.analyser.minDecibels = analyser.minDecibels; adapter.output.analyser.maxDecibels = analyser.maxDecibels; } }

  function markTakes() {
    takes.forEach(function (b) { b.setAttribute("aria-pressed", preview.playing && b.getAttribute("data-name") === preview.name ? "true" : "false"); });
  }
  function takesEnabled(on) {
    takes.forEach(function (b) { b.disabled = !on; });
    vnote.textContent = on ? "The six audition takes. Tap one to hear it through the visual." : "End the call to play a take.";
  }
  function stopPreview(detach) {
    clearTimeout(preview.settleTimer);
    var was = preview.playing;
    preview.playing = false;
    try { audio.pause(); } catch (e) {}
    if (preview.attached && vv) {
      if (was) vv.interrupt();
      if (detach) { vv.detach(); preview.attached = false; vv.setAgentState(snap.state); }
    }
    if (detach) preview.attached = false;
    markTakes(); render();
  }
  function playTake(btn) {
    if (isActive(snap.state) || ctl.conv) return; // never while a live call is attached
    var src = btn.getAttribute("data-src"), name = btn.getAttribute("data-name");
    if (preview.playing && preview.name === name) { stopPreview(false); if (vv && preview.attached) vv.setAgentState("listening"); settleThenDetach(); return; }
    if (preview.playing && vv && preview.attached) vv.interrupt();
    clearTimeout(preview.settleTimer);
    ensureGraph(); syncAdapterRange();
    if (actx && actx.state === "suspended") actx.resume();
    if (snap.state === "ended" || snap.state === "error") set({ state: "idle", error: "", micBlocked: false });
    preview.name = name;
    audio.src = src;
    var p = audio.play();
    if (p && typeof p.then === "function") p.catch(function (e) { console.warn("[hark] take playback blocked", e); stopPreview(true); });
    if (vv && !preview.attached) { vv.attach(adapter); preview.attached = true; }
    else if (!vv) preview.attached = true; // visuals will re-attach the adapter when they mount
    kick();
  }
  function settleThenDetach() {
    clearTimeout(preview.settleTimer);
    preview.settleTimer = setTimeout(function () {
      if (preview.playing || !preview.attached) return;
      preview.attached = false;
      if (vv) { vv.detach(); vv.setAgentState(snap.state); }
    }, 2200);
  }
  audio.addEventListener("playing", function () { preview.playing = true; if (vv && preview.attached) vv.setAgentState("speaking"); markTakes(); render(); kick(); });
  audio.addEventListener("pause", function () { if (!preview.playing) return; preview.playing = false; if (vv && preview.attached) vv.setAgentState("listening"); markTakes(); render(); settleThenDetach(); });
  audio.addEventListener("ended", function () { preview.playing = false; if (vv && preview.attached) vv.setAgentState("listening"); markTakes(); render(); settleThenDetach(); });
  audio.addEventListener("timeupdate", function () {
    var b = takes.filter(function (x) { return x.getAttribute("data-name") === preview.name; })[0];
    if (b && audio.duration) b.style.setProperty("--p", String(audio.currentTime / audio.duration));
  });
  takes.forEach(function (b) { b.addEventListener("click", function () { playTake(b); }); });

  /* ---------- Mic test (only when no call): our own capture, our own analyser ---------- */
  var test = { on: false, stream: null, ctx: null, an: null, raw: null, out: new Uint8Array(BINS), td: null, starting: false };
  function startTest() {
    if (test.on || test.starting || isActive(snap.state) || ctl.conv) return Promise.resolve(false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { note("This browser has no microphone access."); return Promise.resolve(false); }
    stopPreview(true);
    test.starting = true;
    var c = { echoCancellation: S.audio.ec, noiseSuppression: S.audio.ns, autoGainControl: S.audio.agc, channelCount: { ideal: 1 } };
    if (S.source.inputId) c.deviceId = { exact: S.source.inputId };
    return navigator.mediaDevices.getUserMedia({ audio: c }).then(function (stream) {
      test.starting = false;
      if (isActive(snap.state) || ctl.conv) { stream.getTracks().forEach(function (t) { t.stop(); }); return false; }
      var AC = window.AudioContext || window.webkitAudioContext;
      test.ctx = new AC(); test.stream = stream;
      test.an = test.ctx.createAnalyser(); test.an.fftSize = 2048; test.an.smoothingTimeConstant = 0.5;
      test.ctx.createMediaStreamSource(stream).connect(test.an);
      test.raw = new Uint8Array(test.an.frequencyBinCount); test.td = new Float32Array(test.an.fftSize);
      test.on = true;
      if (test.ctx.state === "suspended") test.ctx.resume();
      render(); refreshDevices(); syncTestSwitch(); kick();
      return true;
    }, function (e) {
      test.starting = false; syncTestSwitch();
      note(e && e.name === "NotAllowedError" ? "Microphone blocked. Allow it for this site to test." : "Couldn't open the microphone (" + ((e && e.name) || "error") + ").");
      return false;
    });
  }
  function stopTest() {
    if (test.stream) test.stream.getTracks().forEach(function (t) { t.stop(); });
    if (test.ctx) try { test.ctx.close(); } catch (e) {}
    var was = test.on;
    test.on = false; test.stream = null; test.ctx = null; test.an = null;
    if (was) { render(); syncTestSwitch(); }
  }

  /* ---------- Devices ---------- */
  var devices = { inputs: [], outputs: [] };
  function isIOS() { return /iP(hone|ad|od)/.test(navigator.platform) || (/Mac/.test(navigator.userAgent) && "ontouchend" in document); }
  function sinkSupported() { return !isIOS() && typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype; }
  function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      devices.inputs = list.filter(function (d) { return d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"; });
      devices.outputs = list.filter(function (d) { return d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"; });
      buildDeviceDots();
    }, function () {});
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

  /* ---------- Meter + stats loop ---------- */
  var meter = new UI.Meter($("meter"), { bars: 40 });
  var NB = 40, bandEdges = [], bands = new Float32Array(NB), shown = new Float32Array(NB);
  (function () { for (var i = 0; i <= NB; i++) { var hz = SDK_LO * Math.pow(SDK_HI / SDK_LO, i / NB); bandEdges.push(Math.min(BINS, Math.max(0, Math.round(((hz - SDK_LO) / (SDK_HI - SDK_LO)) * BINS)))); } })();
  var tdIn = null, tdOut = null, gate = { open: false, lastLoud: 0 };
  var raf = 0, lastPitch = 0, lastRead = 0, idleFrames = 0;
  var takeTd = null, specRawIn = null, specRawOut = null;
  var efisEl = $("efis"), roIn = $("roIn"), roOut = $("roOut"), lastMeter = 0, lastRO = 0;
  var reduceMQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function fmtRO(v) { return v <= -119 ? "-inf" : (v < 0 && v > -0.05 ? "0.0" : v.toFixed(1)); }

  function inputSource() {
    if (ctl.conv && isLive(snap.state)) return "call";
    if (test.on) return "test";
    if (preview.attached && (preview.playing || shown[0] > 0.001)) return "take";
    return "off";
  }
  function fillBands(arr, gain) {
    for (var b = 0; b < NB; b++) {
      var i0 = bandEdges[b], i1 = Math.max(i0 + 1, bandEdges[b + 1]), s = 0;
      for (var i = i0; i < i1 && i < arr.length; i++) s += arr[i];
      var v = (s / (i1 - i0)) / 255;
      bands[b] = UI.clamp(Math.pow(v, 1.6) * gain * 1.8, 0, 1);
    }
  }
  function updatePeak(side, db, now) {
    var pk = side === "in" ? "inPk" : "outPk", at = side === "in" ? "inPkAt" : "outPkAt";
    if (db >= st[pk]) { st[pk] = db; st[at] = now; }
    else if (now - st[at] > 1500) st[pk] = Math.max(db, st[pk] - 0.33); // ~20 dB/s fall after a 1.5 s hold
  }
  function readTime(an, buf) { if (!an) return null; if (!buf || buf.length !== an.fftSize) buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf); return buf; }

  function frame(now) {
    raf = 0;
    var src = inputSource(), gainV = S.resp.meterGain * S.audio.sensitivity, vol = 0, arr = null, inAn = null, inSr = 0, outAn = null, outSr = 0;
    var muted = src === "call" && snap.muted;
    if (src === "call") {
      try { arr = ctl.conv.getInputByteFrequencyData(); vol = ctl.conv.getInputVolume(); } catch (e) { arr = null; }
      inAn = sdkAnalyser("input"); inSr = sdkRate("input"); outAn = sdkAnalyser("output"); outSr = sdkRate("output");
      st.inRate = inSr; st.outRate = outSr;
    } else if (src === "test" && test.an) {
      arr = toSdkLayout(test.an, test.raw, test.out, test.ctx.sampleRate); vol = meanByte(arr); inAn = test.an; inSr = test.ctx.sampleRate; tdIn = test.td;
    } else if (src === "take" && analyser) {
      arr = readBins(); vol = preview.playing ? meanByte(arr) : 0; outAn = analyser; outSr = actx.sampleRate;
    }
    if (src === "take" && !preview.playing) arr = null;
    if (arr && arr.length) fillBands(arr, gainV); else bands.fill(0);
    // smoothing/decay: fast attack, decay set by Responsiveness > Smoothing
    var sm = S.resp.smoothing, react = S.resp.reactivity;
    for (var b = 0; b < NB; b++) {
      var target = UI.clamp(bands[b] * react, 0, 1);
      shown[b] = target > shown[b] ? shown[b] + (target - shown[b]) * (1 - sm * 0.5) : shown[b] * sm + target * (1 - sm);
      if (shown[b] < 0.002) shown[b] = 0;
    }
    // gate (same thresholds the bundle's Wave uses)
    var gv = vol * S.audio.sensitivity, gOpen = S.resp.gateOpen, gClose = Math.min(S.resp.gateClose, gOpen);
    if (src === "call" || src === "test") {
      if (gv >= gClose) gate.lastLoud = now;
      if (gv >= gOpen) gate.open = true; else if (gate.open && now - gate.lastLoud > S.resp.holdMs) gate.open = false;
      // latency estimate: the last moment the user's input was above the close threshold while the agent was not speaking
      if (src === "call" && !muted && gv >= gClose && snap.state !== "speaking") st.lastVoiceAt = now;
    } else gate.open = false;
    talkWrap.setAttribute("data-gate", gate.open && !muted ? "open" : "closed");

    // dBFS (time domain) for in/out
    if (src === "take") { st.inDb = -120; }
    if (inAn) { tdIn = readTime(inAn, tdIn); var rp = UI.rmsPeak(tdIn); st.inDb = muted ? -120 : UI.dbfs(rp.rms); }
    else if (src === "call") st.inDb = muted ? -120 : UI.dbfs(vol * 0.5);
    else if (src !== "take") st.inDb = -120;
    if (outAn) { tdOut = readTime(outAn, tdOut); st.outDb = UI.dbfs(UI.rmsPeak(tdOut).rms); } else st.outDb = -120;
    updatePeak("in", st.inDb, now); updatePeak("out", st.outDb, now);

    // ~10 Hz: pitch and centroid
    if (now - lastPitch > 100) {
      lastPitch = now;
      st.f0In = inAn && tdIn && st.inDb > -50 ? UI.pitch(tdIn, inSr) : 0;
      st.f0Out = outAn && tdOut && st.outDb > -50 ? UI.pitch(tdOut, outSr) : 0;
      if (inAn && st.inDb > -55) { specRawIn = specRawIn && specRawIn.length === inAn.frequencyBinCount ? specRawIn : new Uint8Array(inAn.frequencyBinCount); inAn.getByteFrequencyData(specRawIn); st.centIn = UI.centroid(specRawIn, inSr, inAn.fftSize, inAn.minDecibels, inAn.maxDecibels); } else st.centIn = 0;
      if (outAn && st.outDb > -55) { specRawOut = specRawOut && specRawOut.length === outAn.frequencyBinCount ? specRawOut : new Uint8Array(outAn.frequencyBinCount); outAn.getByteFrequencyData(specRawOut); st.centOut = UI.centroid(specRawOut, outSr, outAn.fftSize, outAn.minDecibels, outAn.maxDecibels); } else st.centOut = 0;
    }

    var active = src !== "off";
    // v2.2 strip: the input line is the SDK's own input analyser in a call (never a second capture), the mic-test
    // analyser outside one, or the take's output while previewing. Reduced motion: ~8 fps and a smoothed line.
    var reduced = S.visual.reduced || reduceMQ.matches;
    if (!reduced || now - lastMeter > 120 || !active) {
      lastMeter = now;
      meter.draw({ bands: shown, db: src === "take" ? st.outDb : st.inDb, peakDb: src === "take" ? st.outPk : st.inPk, active: active, gate: gate.open && !muted, muted: muted,
        td: src === "take" ? (outAn ? tdOut : null) : (inAn ? tdIn : null), tdOut: src === "call" && outAn ? tdOut : null, gain: gainV, reduced: reduced });
    }
    var label = src === "call" ? (muted ? "Muted" : "Mic") : src === "test" ? "Test" : src === "take" ? "Take" : "Off";
    if (meterSrcEl.textContent !== label) { meterSrcEl.textContent = label; efisEl.setAttribute("aria-label", "Input meter, " + label); }
    if (now - lastRO > 100 || !active) {
      lastRO = now;
      var tIn = src === "take" || src === "off" ? "-inf" : fmtRO(st.inDb), tOut = fmtRO(st.outDb);
      if (roIn.textContent !== tIn) roIn.textContent = tIn;
      if (roOut.textContent !== tOut) roOut.textContent = tOut;
    }
    talkWrap.setAttribute("data-src", src);
    efisEl.setAttribute("data-src", src);

    // fps
    st.frames++;
    if (now - st.fpsAt >= 1000) { st.fps = Math.round((st.frames * 1000) / (now - st.fpsAt || 1)); st.frames = 0; st.fpsAt = now; }
    if (S.stats.on) { drawGauges(); if (now - lastRead > 200) { lastRead = now; renderReadout(); } }

    var quiet = !active && shown.every(function (x) { return x === 0; });
    idleFrames = quiet ? idleFrames + 1 : 0;
    if (document.hidden) return;
    if (idleFrames < 3 || S.stats.on) raf = requestAnimationFrame(frame);
    else { st.fps = 0; if (S.stats.on) renderReadout(); }
  }
  function kick() { if (!raf && !document.hidden) { idleFrames = 0; st.fpsAt = performance.now(); st.frames = 0; raf = requestAnimationFrame(frame); } }

  /* ---------- Geek stats ---------- */
  var statsPanel = $("statsPanel"), statsBtn = $("statsBtn"), readEl = $("statsRead");
  function dbFrac(db) { return UI.clamp((db + 60) / 60, 0, 1); }
  function drawGauges() {
    var cols = UI.palette();
    UI.gauge($("gIn"), dbFrac(st.inDb), dbFrac(st.inPk), st.inDb <= -119 ? "-\u221e" : st.inDb.toFixed(0), cols);
    UI.gauge($("gOut"), dbFrac(st.outDb), dbFrac(st.outPk), st.outDb <= -119 ? "-\u221e" : st.outDb.toFixed(0), cols);
    var lat = st.lastLat;
    UI.gauge($("gLat"), lat ? UI.clamp(lat / 3000, 0, 1) : 0, null, lat ? (lat / 1000).toFixed(2) + "s" : "--", cols);
  }
  function fmtDb(v) { return v <= -119 ? "-inf" : v.toFixed(1); }
  function fmtHz(v) { return v > 0 ? Math.round(v) + " Hz" : "--"; }
  function fmtTime(ms) { var s = Math.floor(ms / 1000), m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function voiceName(id) { var v = VOICES.filter(function (x) { return x.id === id; })[0]; return v ? v.label : id; }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
  function renderReadout() {
    var live = !!ctl.conv && isActive(snap.state);
    var callVoice = live && ctl.voiceAtStart ? JSON.parse(ctl.voiceAtStart).id : S.voice.id;
    var rows = [
      ["Link", st.online ? st.conn : "offline"],
      ["Session", live && st.startedAt ? fmtTime(Date.now() - st.startedAt) : "--:--"],
      ["Conv id", st.convId ? st.convId.slice(0, 10) + "\u2026" + st.convId.slice(-4) : "--"],
      ["Agent", "\u2026" + AGENT_ID.slice(-8)],
      ["Auth", st.auth || "--"],
      ["Voice", voiceName(callVoice)],
      ["Model", MODEL],
      ["Format", OUT_FORMAT],
      ["Rate", (st.inRate ? (st.inRate / 1000).toFixed(1) + "k in" : test.ctx ? (test.ctx.sampleRate / 1000).toFixed(1) + "k in" : "-- in") + " \u00b7 " + (st.outRate ? (st.outRate / 1000).toFixed(1) + "k out" : actx ? (actx.sampleRate / 1000).toFixed(1) + "k out" : "-- out")],
      ["In dBFS", fmtDb(st.inDb) + " pk " + fmtDb(st.inPk)],
      ["Out dBFS", fmtDb(st.outDb) + " pk " + fmtDb(st.outPk)],
      ["F0 in/out", fmtHz(st.f0In) + " / " + fmtHz(st.f0Out)],
      ["Centroid", fmtHz(st.centIn) + " / " + fmtHz(st.centOut)],
      ["Latency", st.lastLat ? (st.lastLat / 1000).toFixed(2) + " s (med " + (median(st.lat) / 1000).toFixed(2) + ")" : "--"],
      ["Interrupts", String(st.interrupts)],
      ["Gate", (gate.open ? "open" : "closed") + " " + S.resp.gateOpen.toFixed(2) + "/" + Math.min(S.resp.gateClose, S.resp.gateOpen).toFixed(2)],
      ["FPS \u00b7 DPR", (st.fps || "idle") + " \u00b7 " + (window.devicePixelRatio || 1).toFixed(2)],
      ["GPU", st.gl || "--"],
      ["Net", st.online ? "online" : "offline"],
      ["SW cache", st.sw || "--"],
    ];
    var html = "";
    for (var i = 0; i < rows.length; i++) { var t = String(rows[i][1]).replace(/[<&>"]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;"; }); html += "<div><dt>" + rows[i][0] + '</dt><dd title="' + t + '">' + t + "</dd></div>"; }
    readEl.innerHTML = html;
  }
  function glRenderer() {
    try {
      var c = document.createElement("canvas"), gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return "no WebGL";
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      var r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      var lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      return r.replace(/^ANGLE \(|\)$/g, "").slice(0, 48);
    } catch (e) { return "unknown"; }
  }
  function swVersion() {
    if (!window.caches || !caches.keys) { st.sw = "n/a"; return; }
    caches.keys().then(function (k) { var v = k.filter(function (x) { return /^hark-voice-/.test(x); }); st.sw = v.length ? v.join(", ") : "not installed"; }, function () { st.sw = "n/a"; });
  }
  function setStats(on) {
    S.stats.on = !!on; save();
    statsPanel.hidden = !on; stage.setAttribute("data-stats", on ? "on" : "off");
    statsBtn.setAttribute("aria-pressed", on ? "true" : "false");
    statsBtn.setAttribute("aria-label", on ? "Hide geek stats" : "Show geek stats");
    if (on) { if (!st.gl) st.gl = glRenderer(); swVersion(); renderReadout(); drawGauges(); }
    kick();
  }
  statsBtn.addEventListener("click", function () { setStats(!S.stats.on); });
  window.addEventListener("online", function () { st.online = true; });
  window.addEventListener("offline", function () { st.online = false; });

  /* ---------- Applying settings ---------- */
  function applyVisual() {
    document.documentElement.setAttribute("data-palette", S.visual.palette);
    // Grade the bundle's layer: the palette's filter (Original = none) plus intensity as brightness.
    var pf = getComputedStyle(document.documentElement).getPropertyValue("--radial-filter").trim(), parts = [];
    if (pf && pf !== "none") parts.push(pf);
    if (Math.abs(S.visual.intensity - 1) > 0.005) parts.push("brightness(" + S.visual.intensity.toFixed(2) + ")");
    radialLayer.style.filter = parts.length ? parts.join(" ") : "none";
    stage.style.setProperty("--q8vv-light-gain", String(0.45 * S.resp.reactivity));
    stage.setAttribute("data-reduced", S.visual.reduced ? "true" : "false");
    stage.setAttribute("data-bg", S.visual.background);
    meter.setPalette();
    if (S.stats.on) drawGauges();
    meter.draw({ bands: shown, db: -120, peakDb: -120, active: false });
    kick();
  }
  function syncCallBound() {
    var live = isActive(snap.state) || !!ctl.conv;
    if (controls.test) controls.test.disable(live);
    if (controls.testNote) controls.testNote.textContent = live ? "Mic test is off during a call: the call owns the microphone." : "Opens the microphone here only; stops when a call starts.";
    if (controls.voiceNote) {
      var pending = live && ctl.voiceAtStart && ctl.voiceAtStart !== JSON.stringify(S.voice);
      controls.voiceNote.textContent = pending ? "Changed. These apply on the next call; this call keeps its voice." : "Voice changes apply on the next call. Only values you move from the defaults are sent, so a default call uses the agent's own voice setup. Alternative voices still get the accent tag from the agent's prompt.";
    }
  }
  function setOutputVolume(v) {
    if (gainNode) gainNode.gain.value = v;
    try { if (ctl.conv && ctl.conv.setVolume) ctl.conv.setVolume({ volume: v }); } catch (e) {}
  }
  function setOutputDevice(id) {
    if (!sinkSupported()) return;
    if (audio.setSinkId) audio.setSinkId(id || "").catch(function () {});
    if (ctl.conv && ctl.conv.changeOutputDevice) ctl.conv.changeOutputDevice({ outputDeviceId: id || "" }).catch(function () { note("Couldn't switch the output during this call."); });
  }
  function restartTestIfOn() { if (test.on) { stopTest(); startTest(); } }
  var noteEl = $("settingsNote"), noteTimer = 0;
  function note(t) { noteEl.textContent = t; clearTimeout(noteTimer); noteTimer = setTimeout(function () { noteEl.textContent = "Saved on this device."; }, 4000); }

  /* ---------- Settings console UI ---------- */
  var controls = {};
  var SECTIONS = [
    { id: "voice", label: "Voice" }, { id: "visual", label: "Visual" }, { id: "audio", label: "Audio" },
    { id: "resp", label: "Response" }, { id: "source", label: "Source" },
  ];
  var tabsEl = $("settingsTabs"), body = $("settingsBody"), panes = {}, tabBtns = [];
  function group(title, pane, cls) {
    var g = document.createElement("div"); g.className = "group" + (cls ? " " + cls : "");
    if (title) { var h = document.createElement("h3"); h.className = "group__title"; h.textContent = title; g.appendChild(h); }
    var inner = document.createElement("div"); inner.className = "group__row"; g.appendChild(inner);
    pane.appendChild(g); return inner;
  }
  function para(pane, text, cls) { var p = document.createElement("p"); p.className = "pane__note" + (cls ? " " + cls : ""); p.textContent = text; pane.appendChild(p); return p; }
  function kn(o) { var k = UI.knob(o); return k; }
  function upd(sec, key, after) { return function (v) { S[sec][key] = v; save(); if (after) after(v); }; }

  function buildSettings() {
    SECTIONS.forEach(function (s, i) {
      var cell = document.createElement("div"); cell.className = "tab";
      var b = document.createElement("button");
      b.type = "button"; b.className = "tab__btn"; b.id = "tab-" + s.id;
      b.setAttribute("role", "tab"); b.setAttribute("aria-controls", "pane-" + s.id); b.setAttribute("aria-label", s.label);
      var face = document.createElement("span"); face.className = "tab__face"; face.setAttribute("aria-hidden", "true"); face.textContent = String(i + 1);
      b.appendChild(face);
      var lab = document.createElement("span"); lab.className = "tab__label"; lab.setAttribute("aria-hidden", "true"); lab.textContent = s.label;
      cell.appendChild(b); cell.appendChild(lab); tabsEl.appendChild(cell); tabBtns.push(b);
      b.addEventListener("click", function () { showPane(s.id); });
      lab.addEventListener("click", function () { b.click(); });
      b.addEventListener("keydown", function (e) {
        var j = null;
        if (e.key === "ArrowRight") j = (i + 1) % SECTIONS.length; else if (e.key === "ArrowLeft") j = (i - 1 + SECTIONS.length) % SECTIONS.length;
        if (j == null) return; e.preventDefault(); tabBtns[j].focus(); tabBtns[j].click();
      });
      var pane = document.createElement("div"); pane.className = "pane"; pane.id = "pane-" + s.id;
      pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", "tab-" + s.id); pane.hidden = true;
      body.appendChild(pane); panes[s.id] = pane;
    });

    // Voice
    var p = panes.voice;
    controls.voice = UI.dots({ label: "Voice", layout: "list", value: S.voice.id, options: VOICES.map(function (v) { return { value: v.id, label: v.label, sub: v.sub }; }), onChange: function (v) { S.voice.id = v; save(); syncCallBound(); } });
    group("Voice", p).appendChild(controls.voice.el);
    var r = group("Delivery", p, "group--knobs");
    controls.stability = kn({ label: "Stability", min: 0, max: 1, step: 0.01, def: DEFAULTS.voice.stability, value: S.voice.stability, onInput: upd("voice", "stability", syncCallBound) });
    controls.similarity = kn({ label: "Similarity", min: 0, max: 1, step: 0.01, def: DEFAULTS.voice.similarity, value: S.voice.similarity, onInput: upd("voice", "similarity", syncCallBound) });
    controls.speed = kn({ label: "Speed", min: 0.7, max: 1.2, step: 0.01, def: 1, center: 1, value: S.voice.speed, format: function (v) { return v.toFixed(2) + "\u00d7"; }, onInput: upd("voice", "speed", syncCallBound) });
    [controls.stability, controls.similarity, controls.speed].forEach(function (k) { r.appendChild(k.el); });
    controls.voiceNote = para(p, "");

    // Visual
    p = panes.visual;
    controls.palette = UI.dots({ label: "Palette", value: S.visual.palette, options: PALETTES.map(function (x) { return { value: x.id, label: x.label, swatch: x.swatch }; }), onChange: function (v) { S.visual.palette = v; save(); applyVisual(); } });
    group("Palette", p, "group--palette").appendChild(controls.palette.el);
    r = group("Radial", p, "group--split");
    controls.bg = UI.dots({ label: "Radial background", value: S.visual.background, options: [{ value: "halo", label: "Halo" }, { value: "black", label: "Black" }], onChange: function (v) { S.visual.background = v; save(); stage.setAttribute("data-bg", v); if (vv) vv.update({ background: v }); } });
    controls.motion = UI.dots({ label: "Motion", value: S.visual.motion, options: [{ value: "speech", label: "Speech" }, { value: "original", label: "Drift" }], onChange: function (v) { S.visual.motion = v; save(); if (vv) vv.update({ motion: v }); } });
    var bgw = document.createElement("div"); bgw.className = "sub"; bgw.innerHTML = '<span class="sub__k">Background</span>'; bgw.appendChild(controls.bg.el);
    var mw = document.createElement("div"); mw.className = "sub"; mw.innerHTML = '<span class="sub__k">Motion</span>'; mw.appendChild(controls.motion.el);
    r.appendChild(bgw); r.appendChild(mw);
    r = group("Levels and style", p, "group--knobs");
    controls.intensity = kn({ label: "Intensity", min: 0.4, max: 1.4, step: 0.01, def: 1, value: S.visual.intensity, format: function (v) { return Math.round(v * 100) + "%"; }, onInput: upd("visual", "intensity", function () { applyVisual(); }) });
    r.appendChild(controls.intensity.el);
    var sw = document.createElement("div"); sw.className = "switches";
    controls.wave = UI.toggle({ label: "Wave", hint: "The bundle's line meter under the controls", value: S.visual.wave, onChange: upd("visual", "wave", function () { pipDock.hidden = !S.visual.wave; remountViz(0); }) });
    controls.reduced = UI.toggle({ label: "Reduced motion", hint: "Holds the radial still; also follows your system setting", value: S.visual.reduced, onChange: upd("visual", "reduced", function () { applyVisual(); applyMotionHold(); }) });
    sw.appendChild(controls.wave.el); sw.appendChild(controls.reduced.el); r.appendChild(sw);

    // Audio
    p = panes.audio;
    r = group("Output and input", p, "group--knobs");
    controls.volume = kn({ label: "Volume", min: 0, max: 1, step: 0.01, def: 1, value: S.audio.volume, format: function (v) { return Math.round(v * 100) + "%"; }, onInput: upd("audio", "volume", setOutputVolume) });
    controls.sens = kn({ label: "Sensitivity", min: 0.25, max: 4, step: 0.05, def: 1, center: 1, value: S.audio.sensitivity, format: function (v) { return v.toFixed(2) + "\u00d7"; }, onInput: upd("audio", "sensitivity", function () { remountViz(); }) });
    r.appendChild(controls.volume.el); r.appendChild(controls.sens.el);
    r = group("Mic processing", p);
    sw = document.createElement("div"); sw.className = "switches";
    controls.ec = UI.toggle({ label: "Echo cancellation", value: S.audio.ec, onChange: upd("audio", "ec", restartTestIfOn) });
    controls.ns = UI.toggle({ label: "Noise suppression", value: S.audio.ns, onChange: upd("audio", "ns", restartTestIfOn) });
    controls.agc = UI.toggle({ label: "Auto gain", value: S.audio.agc, onChange: upd("audio", "agc", restartTestIfOn) });
    [controls.ec, controls.ns, controls.agc].forEach(function (t) { sw.appendChild(t.el); }); r.appendChild(sw);
    para(p, "These three apply to the mic test only. The ElevenLabs call engine (SDK 1.35) always runs echo cancellation, noise suppression and auto gain on, and has no option to change them.");

    // Responsiveness
    p = panes.resp;
    r = group("Meter", p, "group--knobs");
    controls.mgain = kn({ label: "Meter gain", min: 0.5, max: 4, step: 0.05, def: DEFAULTS.resp.meterGain, value: S.resp.meterGain, format: function (v) { return v.toFixed(2) + "\u00d7"; }, onInput: upd("resp", "meterGain") });
    controls.smooth = kn({ label: "Smoothing", min: 0, max: 0.95, step: 0.01, def: DEFAULTS.resp.smoothing, value: S.resp.smoothing, onInput: upd("resp", "smoothing") });
    controls.react = kn({ label: "Reactivity", min: 0, max: 2, step: 0.05, def: 1, center: 1, value: S.resp.reactivity, format: function (v) { return v.toFixed(2) + "\u00d7"; }, onInput: upd("resp", "reactivity", function () { applyVisual(); }) });
    [controls.mgain, controls.smooth, controls.react].forEach(function (k) { r.appendChild(k.el); });
    r = group("Noise gate", p, "group--knobs");
    controls.gopen = kn({ label: "Open", min: 0.01, max: 0.5, step: 0.01, def: DEFAULTS.resp.gateOpen, value: S.resp.gateOpen, onInput: upd("resp", "gateOpen", function (v) { if (S.resp.gateClose > v) { S.resp.gateClose = v; controls.gclose.set(v); } remountViz(); }) });
    controls.gclose = kn({ label: "Close", min: 0.01, max: 0.5, step: 0.01, def: DEFAULTS.resp.gateClose, value: S.resp.gateClose, onInput: upd("resp", "gateClose", function (v) { if (v > S.resp.gateOpen) { S.resp.gateClose = S.resp.gateOpen; controls.gclose.set(S.resp.gateOpen); } remountViz(); }) });
    controls.ghold = kn({ label: "Hold", min: 0, max: 1000, step: 10, def: DEFAULTS.resp.holdMs, value: S.resp.holdMs, format: function (v) { return Math.round(v) + " ms"; }, onInput: upd("resp", "holdMs", function () { remountViz(); }) });
    [controls.gopen, controls.gclose, controls.ghold].forEach(function (k) { r.appendChild(k.el); });
    para(p, "The gate decides when your voice counts as speech for the meter lamp, the Wave and the latency estimate. Changing it rebuilds the visuals for a moment; a call keeps running. Defaults are uncalibrated: watch In dBFS in the stats while silent and while talking, then set Open just above your room's silence.");

    // Source
    p = panes.source;
    r = group("Microphone", p);
    controls.input = UI.dots({ label: "Microphone", layout: "list", value: S.source.inputId, options: [{ value: "", label: "System default" }], onChange: function (v) { S.source.inputId = v; save(); restartTestIfOn(); if (ctl.conv) note("The new microphone applies on the next call."); } });
    r.appendChild(controls.input.el);
    controls.inputNote = para(p, "Device names appear after you allow the microphone (run the mic test once). A new microphone applies on the next call.");
    r = group("Mic test", p);
    controls.test = UI.toggle({ label: "Test mic", onText: "Running", offText: "Off", value: false, onChange: function (on) { if (on) startTest().then(function (ok) { if (!ok) controls.test.set(false); }); else stopTest(); } });
    r.appendChild(controls.test.el);
    controls.testNote = para(p, "");
    controls.outGroup = group("Output", p);
    controls.output = UI.dots({ label: "Speaker", layout: "list", value: S.source.outputId, options: [{ value: "", label: "System default" }], onChange: function (v) { S.source.outputId = v; save(); setOutputDevice(v); } });
    controls.outGroup.appendChild(controls.output.el);
    controls.outGroup.parentNode.hidden = !sinkSupported();
    if (!sinkSupported()) para(p, "Speaker choice isn't available in this browser; audio follows the system output.");

    showPane("voice");
    syncCallBound();
  }
  function syncTestSwitch() { if (controls.test) controls.test.set(test.on); }
  function buildDeviceDots() {
    if (!controls.input) return;
    function label(d, i, kind) { return d.label || (kind + " " + (i + 1)); }
    var ins = [{ value: "", label: "System default" }].concat(devices.inputs.map(function (d, i) { return { value: d.deviceId, label: label(d, i, "Microphone") }; }));
    if (S.source.inputId && !devices.inputs.some(function (d) { return d.deviceId === S.source.inputId; })) ins.push({ value: S.source.inputId, label: "Saved microphone (not connected)" });
    controls.input.rebuild(ins, S.source.inputId);
    var outs = [{ value: "", label: "System default" }].concat(devices.outputs.map(function (d, i) { return { value: d.deviceId, label: label(d, i, "Speaker") }; }));
    controls.output.rebuild(outs, S.source.outputId);
  }
  function showPane(id) {
    SECTIONS.forEach(function (s, i) { var on = s.id === id; panes[s.id].hidden = !on; tabBtns[i].setAttribute("aria-selected", on ? "true" : "false"); tabBtns[i].tabIndex = on ? 0 : -1; });
  }
  function syncControls() {
    controls.voice.set(S.voice.id); controls.stability.set(S.voice.stability); controls.similarity.set(S.voice.similarity); controls.speed.set(S.voice.speed);
    controls.palette.set(S.visual.palette); controls.bg.set(S.visual.background); controls.motion.set(S.visual.motion); controls.intensity.set(S.visual.intensity);
    controls.wave.set(S.visual.wave); controls.reduced.set(S.visual.reduced);
    controls.volume.set(S.audio.volume); controls.sens.set(S.audio.sensitivity); controls.ec.set(S.audio.ec); controls.ns.set(S.audio.ns); controls.agc.set(S.audio.agc);
    controls.mgain.set(S.resp.meterGain); controls.smooth.set(S.resp.smoothing); controls.react.set(S.resp.reactivity);
    controls.gopen.set(S.resp.gateOpen); controls.gclose.set(S.resp.gateClose); controls.ghold.set(S.resp.holdMs);
    buildDeviceDots();
  }
  function resetAll() {
    var hadWave = S.visual.wave, statsOn = S.stats.on;
    S = clone(DEFAULTS); S.stats.on = statsOn;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
    syncControls(); applyVisual(); applyMotionHold(); setOutputVolume(1); setOutputDevice("");
    if (vv) vv.update({ motion: S.visual.motion, background: S.visual.background });
    pipDock.hidden = true;
    remountViz(hadWave ? 0 : 200);
    restartTestIfOn(); syncCallBound();
    note("Reset to defaults.");
  }
  $("settingsReset").addEventListener("click", resetAll);

  /* ---------- Sheets ---------- */
  var setSheet = $("settingsSheet"), setBtn = $("settingsBtn"), setClose = $("settingsClose"), opener = null;
  function closeAll(focusBack) {
    var was = !sheet.hidden || !setSheet.hidden;
    sheet.hidden = true; setSheet.hidden = true; scrim.hidden = true;
    stage.setAttribute("data-sheet", "closed");
    openBtn.setAttribute("aria-expanded", "false"); setBtn.setAttribute("aria-expanded", "false");
    if (was && focusBack !== false && opener) opener.focus({ preventScroll: true });
  }
  function openSheet(which) {
    closeAll(false);
    var s = which === "settings" ? setSheet : sheet, b = which === "settings" ? setBtn : openBtn, c = which === "settings" ? setClose : closeBtn;
    opener = b; s.hidden = false; scrim.hidden = false;
    stage.setAttribute("data-sheet", which);
    b.setAttribute("aria-expanded", "true");
    setTimeout(function () { c.focus({ preventScroll: true }); }, 30);
  }
  openBtn.addEventListener("click", function () { if (sheet.hidden) openSheet("takes"); else closeAll(); });
  setBtn.addEventListener("click", function () { if (setSheet.hidden) { refreshDevices(); openSheet("settings"); } else closeAll(); });
  closeBtn.addEventListener("click", function () { closeAll(); });
  setClose.addEventListener("click", function () { closeAll(); });
  scrim.addEventListener("click", function () { closeAll(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && (!sheet.hidden || !setSheet.hidden)) closeAll(); });

  /* ---------- page lifecycle ---------- */
  window.addEventListener("pagehide", function () { stopPreview(true); stopTest(); teardown(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { if (vv) vv.pause(); if (preview.playing) audio.pause(); if (test.on) stopTest(); }
    else { if (!vv) mountViz(); applyMotionHold(); if (isActive(snap.state)) wake(true); kick(); }
  });

  /* ---------- boot ---------- */
  buildSettings();
  applyVisual();
  if (S.source.outputId && sinkSupported() && audio.setSinkId) audio.setSinkId(S.source.outputId).catch(function () {});
  refreshDevices();
  talkBtn.disabled = false;
  render();
  setStats(S.stats.on);
  if (window.Q8VoiceVisuals) mountViz(); else window.addEventListener("q8-voice-visuals-ready", mountViz, { once: true });
  loadSdk().catch(function () { if (!ctl.conv) set({ state: "error", error: COPY.unavailable }); });
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function (r) { if (DEV) console.info("[hark] sw registered", r.scope); setTimeout(swVersion, 1500); }, function (e) { console.warn("[hark] sw registration failed", e); });
    });
  }
  window.__harkVoice = {
    snap: function () { return snap; }, vv: function () { return vv; }, preview: preview, settings: function () { return S; },
    stats: function () { return st; }, meterBands: function () { return Array.prototype.slice.call(shown); }, overrides: ttsOverrides, gate: gate,
  };
})();
