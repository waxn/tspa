import { api } from "./api.js";
import { reloadSoon, load } from "./store.js";
import { toast } from "./util.js";

let reg = null, cfg = {};

const b64 = (s) => Uint8Array.from(atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function status() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "blocked" : "off";
}

export async function enable() {
  if (!("Notification" in window)) return toast("this browser has no notifications", "warn");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("notifications not allowed (check site settings)", "warn");
  if (reg && cfg.vapid_public_key && "PushManager" in window) {
    try {
      let sub = await reg.pushManager.getSubscription();
      sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.vapid_public_key) });
      await api.post("/api/push/subscribe", sub.toJSON());
      toast("notifications on (works even when the tab is closed)");
    } catch (e) { toast("push setup failed: " + e.message + " — popups work while a tab is open", "warn"); }
  } else toast("notifications on while a tab is open (set VAPID keys for closed-tab push)");
}

export async function disable() {
  try {
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch (_) {}
  toast("push unsubscribed on this device (browser permission stays — revoke it in site settings to fully mute)");
}

async function popup(ev) {
  toast("⏰ " + ev.text, "warn");
  if (status() !== "on") return;
  const opts = { body: ev.text, silent: true, tag: "r" + ev.id };
  try { if (reg) await reg.showNotification("tspa reminder", opts); else new Notification("tspa reminder", opts); } catch (_) {}
}

export async function init(config, onState) {
  cfg = config;
  if ("serviceWorker" in navigator) {
    try { reg = await navigator.serviceWorker.register("/sw.js"); } catch (_) {}
  }
  let first = true;
  const es = new EventSource("/api/events");
  es.onopen = () => { if (!first) load().catch(() => {}); first = false; };
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "changed") reloadSoon();
    else if (ev.type === "reminder") popup(ev);
  };
  onState?.();
}
