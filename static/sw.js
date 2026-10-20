// Silent notifications only: no sound, no vibration. Static files are cached so the app still opens on bad wifi.
const CACHE = "tspa-static-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// network first, cache as the fallback: you never see stale code when online
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith("/static/")) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "tspa", {
    body: d.body || "", silent: true, tag: "r" + (d.id ?? ""), renotify: false,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((l) => (l.length ? l[0].focus() : self.clients.openWindow("/"))));
});
