/* ПУЛЬТ — service worker: офлайн-оболочка, сеть всегда в приоритете. */
"use strict";
const VER = "pult-v1";
const SHELL = [
  "./", "./app.html", "./style.css", "./app.js", "./web-config.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                  // API-отправка — только сеть
  const url = new URL(req.url);
  if (url.pathname.includes("/api/")) return;        // API/WS никогда не кэшируем
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);                // сеть первой — без устареваний
      if (fresh && fresh.ok && (url.origin === location.origin)) {
        const cache = await caches.open(VER);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const shell = await caches.match("./app.html", { ignoreSearch: true });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
