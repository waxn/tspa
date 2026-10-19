// Silent notifications only: no sound, no vibration.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
