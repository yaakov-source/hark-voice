/* Hark Voice service worker: cache-first for the app shell and media; ElevenLabs and every other
   cross-origin request always goes to the network (never cached, never intercepted). */
var VERSION = "hark-voice-v2-1";
var SHELL = [
  "./", "index.html", "notices.html", "manifest.webmanifest",
  "hark.css", "hark-ui.js", "hark-voice.js",
  "elevenlabs-client-1.35.0.iife.js", "libsamplerate.worklet.js",
  "q8-voice-visuals.js", "q8-voice-visuals.css",
  "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png",
  "apple-touch-icon.png", "favicon-32.png",
  "elevenlabs-client-LICENSE.txt", "libsamplerate-LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "q8-voice-visuals.NOTICES.txt"
];
var MEDIA = ["her-3", "her-1", "her-2", "him-1", "him-2", "him-3"].map(function (n) { return "hark-" + n + ".mp3"; });

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL).then(function () {
      // media is cached best-effort so a slow network never blocks install
      return Promise.all(MEDIA.map(function (u) { return c.add(u).catch(function () {}); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Safari needs 206 answers to Range requests for <audio>; slice the cached full file.
function rangeResponse(req, res) {
  var m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (!m) return res;
  return res.arrayBuffer().then(function (buf) {
    var size = buf.byteLength;
    var start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    var end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
    return new Response(buf.slice(start, end + 1), {
      status: 206, statusText: "Partial Content",
      headers: { "Content-Type": res.headers.get("Content-Type") || "audio/mpeg", "Content-Range": "bytes " + start + "-" + end + "/" + size, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" },
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ElevenLabs API/websocket and anything third-party: network only
  if (req.mode === "navigate") {
    // pages: network first so updates land, cached shell when offline
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match("index.html"); }); }));
    return;
  }
  var isMedia = /\/hark-(her|him)-[0-9]\.mp3$/.test(url.pathname);
  var key = isMedia ? new Request(url.href) : req;
  e.respondWith(caches.match(key, { ignoreSearch: true }).then(function (hit) {
    if (hit) return isMedia && req.headers.has("range") ? rangeResponse(req, hit) : hit;
    return fetch(isMedia ? new Request(url.href) : req).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(key, copy); }); }
      if (isMedia && req.headers.has("range") && res.status === 200) return rangeResponse(req, res.clone());
      return res;
    });
  }));
});
