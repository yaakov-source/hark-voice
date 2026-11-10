/* Hark Voice controller (app/hark-voice.js).
 * Wiring follows the Q8 v6 voice controller (q8-v6/site/app/voice.js) and the voice lane README:
 *   mount once (window.Q8VoiceVisuals or 'q8-voice-visuals-ready'), no gate option (uncalibrated defaults);
 *   Conversation.startSession resolves -> vv.attach(conv); every state change -> vv.setAgentState;
 *   setMicMuted -> vv.setMuted; onInterruption -> vv.interrupt() + listening; teardown -> vv.detach();
 *   visibility -> vv.pause()/vv.resume(). The page opens no microphone itself: the SDK's session is the only
 *   getUserMedia. The Voices sheet feeds the radial from a page-side adapter over an <audio> element, never
 *   while a live call is attached. */
(function () {
  "use strict";
  var AGENT_ID = "agent_9801m72z3174f3xrhjzj6de3kf8q";
  var LIBSAMPLERATE_PATH = "libsamplerate.worklet.js";
  var CONNECT_TIMEOUT = 15000;
  var DEV = (function () {
    try { var h = location.hostname; return !h || h === "localhost" || h === "127.0.0.1" || /[?&]vizdebug\b/.test(location.search); } catch (e) { return false; }
  })();

  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), ui = $("voiceUI");
  var statusEl = $("statusText"), inputLine = $("inputLine"), inputText = $("inputText"), gpuEl = $("gpuNote"), micHelp = $("micHelp");
  var talkBtn = $("talkBtn"), talkLabel = $("talkLabel"), muteBtn = $("muteBtn");

  /* ---------- GPU note (classified like Q8 v6 checkpoint 0640) ---------- */
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
    else if (/running|ready|mounted|restored|idle|paused|still|webgl|live/.test(status)) delete gpuFailed[part];
    var kinds = Object.keys(gpuFailed).map(function (p) { return gpuFailed[p]; });
    var kind = kinds.indexOf("failed") >= 0 ? "failed" : kinds.indexOf("lost") >= 0 ? "lost" : kinds.indexOf("error") >= 0 ? "error" : null;
    if (kind) gpuEl.textContent = GPU_COPY[kind];
    gpuEl.hidden = !kind;
    ui.setAttribute("data-gpu", kind === "failed" ? "unavailable" : kind || "ok");
  }

  /* ---------- visuals ---------- */
  var vv = null;
  function mountViz() {
    if (vv || !window.Q8VoiceVisuals) return;
    try {
      vv = window.Q8VoiceVisuals.mount({
        scene: $("q8-voice-scene"), pip: $("q8-voice-pip"),
        motion: "speech", background: "halo", pipInk: "gradient",
        onStatus: function (part, status, detail) {
          if (/failed|context-lost|unavailable/.test(status)) console.warn("[hark voice visuals]", part, status, detail || "");
          ui.setAttribute("data-vv-" + part, status);
          gpuStatus(part, String(status));
        },
      });
      syncViz();
      if (document.hidden) vv.pause();
    } catch (e) { vv = null; console.warn("[hark voice visuals] mount failed", e); gpuStatus("scene", "failed"); }
  }
  function syncViz() {
    if (!vv) return;
    if (preview.attached) return; // the take player owns the agent state while it is attached
    vv.setAgentState(snap.state);
  }

  /* ---------- state ---------- */
  var COPY = {
    idle: "Ready when you are",
    connecting: "Connecting",
    listening: "Listening",
    interrupted: "Listening",
    speaking: "Speaking",
    ended: "Ended",
    connect: "Couldn't connect. Check your connection and try again.",
    mic: "Microphone blocked. Allow it, then try again.",
    noMic: "No microphone found.",
    audio: "Audio was blocked. Tap Talk to Hark again.",
    lost: "Connection lost. Tap Talk to Hark again.",
    micFailed: "The microphone stopped responding. Try again.",
    unavailable: "Voice is unavailable right now.",
  };
  var snap = { state: "idle", muted: false, canMute: false, error: "", micBlocked: false };
  var ctl = { epoch: 0, conv: null, connectTimer: 0, lastMode: "listening", lostEarly: false, cut: false };
  function isLive(s) { return s === "listening" || s === "speaking"; }
  function isActive(s) { return s === "connecting" || isLive(s); }

  function statusText(s) {
    switch (s.state) {
      case "connecting": return COPY.connecting;
      case "listening": return COPY.listening;
      case "speaking": return COPY.speaking;
      case "ended": return COPY.ended;
      case "error": return s.error || COPY.connect;
      default: return preview.playing ? "Playing " + preview.name : COPY.idle;
    }
  }
  function inputState(s) {
    if (s.state === "connecting") return "Mic starting";
    if (isLive(s.state)) return s.muted ? "Muted" : "Mic on, listening";
    return "Mic off";
  }
  function render() {
    var s = snap;
    stage.setAttribute("data-state", s.state);
    stage.setAttribute("data-speaking", s.state === "speaking" ? "true" : "false");
    stage.setAttribute("data-muted", isLive(s.state) && s.muted ? "true" : "false");
    var t = statusText(s); if (statusEl.textContent !== t) statusEl.textContent = t;
    var it = inputState(s); if (inputText.textContent !== it) inputText.textContent = it;
    inputLine.setAttribute("data-input", it === "Muted" ? "muted" : it === "Mic on, listening" ? "listening" : it === "Mic starting" ? "starting" : "off");
    talkLabel.textContent = isActive(s.state) ? "End" : s.state === "ended" || s.state === "error" ? "Talk again" : "Talk to Hark";
    talkBtn.setAttribute("aria-label", isActive(s.state) ? "End the call with Hark" : "Talk to Hark");
    muteBtn.disabled = !isLive(s.state) || !s.canMute;
    muteBtn.setAttribute("aria-pressed", isLive(s.state) && s.muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", s.muted ? "Unmute microphone" : "Mute microphone");
    micHelp.hidden = !s.micBlocked;
    takesEnabled(!isActive(s.state));
  }
  function set(patch) {
    var changed = false;
    for (var k in patch) if (snap[k] !== patch[k]) { snap[k] = patch[k]; changed = true; }
    if (!changed) return;
    render();
    syncViz();
    wake(isActive(snap.state));
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
    ctl.lastMode = "listening"; ctl.lostEarly = false; ctl.cut = false;
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
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return { state: "error", error: COPY.noMic };
    return { state: "error", error: COPY.connect };
  }

  function startCall() {
    if (ctl.conv || isActive(snap.state)) teardown();
    stopPreview(true); // never feed the radial from a take while a live call is attached
    var my = ++ctl.epoch;
    var current = function () { return my === ctl.epoch; };
    var guard = function (fn) { return function () { if (!current()) return; return fn.apply(null, arguments); }; };
    ctl.lastMode = "listening"; ctl.lostEarly = false; ctl.cut = false;
    set({ state: "connecting", muted: false, error: "", canMute: false, micBlocked: false });
    ctl.connectTimer = setTimeout(function () { if (current()) teardown({ state: "error", error: COPY.connect }); }, CONNECT_TIMEOUT);
    loadSdk().then(function (Conversation) {
      if (!current()) return null;
      return Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "websocket",
        libsampleratePath: LIBSAMPLERATE_PATH,
        onConnect: guard(function () { if (DEV) console.info("[hark] connected"); }),
        onStatusChange: guard(function (st) { if (DEV) console.info("[hark] status", st && st.status ? st.status : st); }),
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
          ctl.lastMode = value === "speaking" ? "speaking" : "listening";
          if (!isLive(snap.state)) return;
          if (ctl.lastMode === "speaking") { ctl.cut = false; set({ state: "speaking" }); }
          else set({ state: "listening" });
        }),
        onInterruption: guard(function () {
          ctl.cut = true;
          if (vv) vv.interrupt();
          if (snap.state === "speaking") set({ state: "listening" });
        }),
      });
    }).then(function (c) {
      if (!c) return;
      if (!current()) { endQuietly(c); return; }
      clearTimeout(ctl.connectTimer); ctl.connectTimer = 0;
      ctl.conv = c;
      if (ctl.lostEarly) { teardown({ state: "error", error: COPY.lost }); return; }
      set({ state: ctl.lastMode, canMute: typeof c.setMicMuted === "function", error: "" });
      if (vv) vv.attach(c);
    }).catch(function (err) {
      if (!current()) return;
      if (DEV) console.warn("[hark] start failed", err);
      if (err && err.sdkLoadFailed) { teardown({ state: "error", error: COPY.unavailable }); return; }
      teardown(startError(err));
    });
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

  /* ---------- Screen wake lock during a call (where supported) ---------- */
  var lock = null;
  function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock && !document.hidden) navigator.wakeLock.request("screen").then(function (l) { lock = l; l.addEventListener("release", function () { lock = null; }); }, function () {});
      else if (!on && lock) { lock.release(); lock = null; }
    } catch (e) {}
  }

  /* ---------- Voices sheet: audition takes through a page-side adapter ---------- */
  var sheet = $("voicesSheet"), scrim = $("sheetScrim"), openBtn = $("voicesOpen"), closeBtn = $("voicesClose"), note = $("voicesNote");
  var audio = $("takeAudio");
  var takes = Array.prototype.slice.call(document.querySelectorAll(".take"));
  var preview = { attached: false, playing: false, name: "", settleTimer: 0 };
  var actx = null, analyser = null, srcNode = null, rawBytes = null, outBytes = new Uint8Array(1024), EMPTY = new Uint8Array(0);
  var SDK_LO = 100, SDK_HI = 8000, BINS = 1024;

  function ensureGraph() {
    if (actx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      actx = new AC();
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048; // 1024 raw bins
      srcNode = actx.createMediaElementSource(audio);
      srcNode.connect(analyser); analyser.connect(actx.destination);
      rawBytes = new Uint8Array(analyser.frequencyBinCount);
      return true;
    } catch (e) { console.warn("[hark] take analyser unavailable", e); actx = null; return false; }
  }
  // Same layout as the SDK's getOutputByteFrequencyData: 1024 bins, linear 100-8000 Hz, resampled from the raw FFT.
  function readBins() {
    if (!analyser) { outBytes.fill(0); return outBytes; }
    analyser.getByteFrequencyData(rawBytes);
    var hzPerBin = actx.sampleRate / analyser.fftSize, n = rawBytes.length;
    for (var i = 0; i < BINS; i++) {
      var hz = SDK_LO + (i * (SDK_HI - SDK_LO)) / BINS;
      var x = hz / hzPerBin, k = Math.floor(x), f = x - k;
      var a = k < n ? rawBytes[k] : 0, b = k + 1 < n ? rawBytes[k + 1] : 0;
      outBytes[i] = Math.round(a + (b - a) * f);
    }
    return outBytes;
  }
  var adapter = {
    type: "voice",
    output: { analyser: { minDecibels: -100, maxDecibels: -30 } },
    getOutputVolume: function () {
      if (!preview.playing) return 0;
      var d = readBins(), s = 0; for (var i = 0; i < d.length; i++) s += d[i];
      return s / d.length / 255;
    },
    getOutputByteFrequencyData: function () { if (!preview.playing) { outBytes.fill(0); return outBytes; } return readBins(); },
    getInputVolume: function () { return 0; },
    getInputByteFrequencyData: function () { return EMPTY; },
  };
  // Re-read the analyser's real dB range once it exists.
  function syncAdapterRange() { if (analyser) { adapter.output.analyser.minDecibels = analyser.minDecibels; adapter.output.analyser.maxDecibels = analyser.maxDecibels; } }

  function markTakes() {
    takes.forEach(function (b) { b.setAttribute("aria-pressed", preview.playing && b.getAttribute("data-name") === preview.name ? "true" : "false"); });
  }
  function takesEnabled(on) {
    takes.forEach(function (b) { b.disabled = !on; });
    note.textContent = on ? "The six audition takes. Tap one to hear it through the visual." : "End the call to play a take.";
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
    if (preview.playing && vv && preview.attached) vv.interrupt(); // switching takes: abrupt cut first
    clearTimeout(preview.settleTimer);
    ensureGraph(); syncAdapterRange();
    if (actx && actx.state === "suspended") actx.resume();
    if (snap.state === "ended" || snap.state === "error") set({ state: "idle", error: "", micBlocked: false });
    preview.name = name;
    audio.src = src;
    var p = audio.play();
    if (p && typeof p.then === "function") p.catch(function (e) { console.warn("[hark] take playback blocked", e); stopPreview(true); });
    if (vv && !preview.attached) { vv.attach(adapter); preview.attached = true; }
  }
  function settleThenDetach() {
    clearTimeout(preview.settleTimer);
    preview.settleTimer = setTimeout(function () {
      if (preview.playing || !preview.attached || !vv) return;
      vv.detach(); preview.attached = false; vv.setAgentState(snap.state);
    }, 2200);
  }
  audio.addEventListener("playing", function () { preview.playing = true; if (vv && preview.attached) vv.setAgentState("speaking"); markTakes(); render(); });
  audio.addEventListener("pause", function () { if (!preview.playing) return; preview.playing = false; if (vv && preview.attached) vv.setAgentState("listening"); markTakes(); render(); settleThenDetach(); });
  audio.addEventListener("ended", function () { preview.playing = false; if (vv && preview.attached) vv.setAgentState("listening"); markTakes(); render(); settleThenDetach(); });
  takes.forEach(function (b) { b.addEventListener("click", function () { playTake(b); }); });

  function openSheet() { sheet.hidden = false; scrim.hidden = false; stage.setAttribute("data-sheet", "open"); openBtn.setAttribute("aria-expanded", "true"); setTimeout(function () { closeBtn.focus({ preventScroll: true }); }, 30); }
  function closeSheet() { sheet.hidden = true; scrim.hidden = true; stage.setAttribute("data-sheet", "closed"); openBtn.setAttribute("aria-expanded", "false"); openBtn.focus({ preventScroll: true }); }
  openBtn.addEventListener("click", function () { if (sheet.hidden) openSheet(); else closeSheet(); });
  closeBtn.addEventListener("click", closeSheet);
  scrim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  /* ---------- page lifecycle ---------- */
  window.addEventListener("pagehide", function () { stopPreview(true); teardown(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { if (vv) vv.pause(); if (preview.playing) audio.pause(); }
    else { if (!vv) mountViz(); if (vv) vv.resume(); if (isActive(snap.state)) wake(true); }
  });

  /* ---------- boot ---------- */
  talkBtn.disabled = false;
  render();
  if (window.Q8VoiceVisuals) mountViz(); else window.addEventListener("q8-voice-visuals-ready", mountViz, { once: true });
  loadSdk().catch(function () { if (!ctl.conv) set({ state: "error", error: COPY.unavailable }); });
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function (r) { if (DEV) console.info("[hark] sw registered", r.scope); }, function (e) { console.warn("[hark] sw registration failed", e); });
    });
  }
  window.__harkVoice = { snap: function () { return snap; }, vv: function () { return vv; }, preview: preview };
})();
