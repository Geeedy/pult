/* ПУЛЬТ — service worker: офлайн-оболочка, сеть всегда в приоритете. */
"use strict";
const VER = "pult-v7";
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

/* ---------------- push-уведомления ---------------- */
/* Кнопки ДА/НЕТ в пуше: Android/Chrome показывает и отвечает без открытия
   приложения. iOS кнопки игнорирует (ограничение Apple для веб-приложений) —
   там тап открывает приложение сразу на карточке подтверждения. */
const AUTH_CACHE = "pult-auth";

async function getAuth() {
  try {
    const cache = await caches.open(AUTH_CACHE);
    const r = await cache.match("/__auth");
    return r ? await r.json() : null;
  } catch (err) { return null; }
}

/* ответ на подтверждение прямо из service worker (приложение может быть закрыто) */
async function answerFromSW(eventId, value) {
  const a = await getAuth();
  if (!a || !a.token || !a.base) return false;
  try {
    const r = await fetch(a.base + "/api/events/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Token": a.token },
      body: JSON.stringify({ eventId, value }),
    });
    return r.ok;
  } catch (err) { return false; }
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {
    d = { title: "ПУЛЬТ", body: (e.data && e.data.text()) || "" };
  }
  const opts = {
    body: d.body || "",
    tag: d.tag || d.eventId || "dsh",
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: d.url || "./app.html", eventId: d.eventId || "", kind: d.kind || "" },
  };
  if (d.kind === "approval") {
    opts.actions = [
      { action: "allow", title: "ДА" },
      { action: "deny", title: "НЕТ" },
    ];
  }
  e.waitUntil(self.registration.showNotification(d.title || "ПУЛЬТ", opts));
});

async function openApp(url, eventId) {
  const target = new URL(url || "./app.html", self.location.origin).href;
  const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) {
    if (c.url.includes("app.html")) {
      try { c.postMessage({ type: "open-ask", eventId: eventId || "" }); } catch (err) {}
      await c.focus();
      return;
    }
  }
  await clients.openWindow(target);
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  if (e.action && d.eventId) {
    /* нажата кнопка в уведомлении — отвечаем, не открывая приложение */
    const value = e.action === "allow" ? "allowed-once" : "rejected";
    e.waitUntil((async () => {
      const ok = await answerFromSW(d.eventId, value);
      if (!ok) await openApp(d.url, d.eventId); /* не вышло — открываем приложение */
    })());
    return;
  }
  /* обычный тап: если приложение живо — фокус и команда открыть карточку,
     иначе открываем app.html#ask=<id> */
  e.waitUntil(openApp(d.url, d.eventId));
});
