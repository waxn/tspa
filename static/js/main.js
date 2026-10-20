import { api } from "./api.js";
import { newNote, itemForm, widgetForm } from "./actions.js";
import { openCapture } from "./capture.js";
import { openHelp } from "./help.js";
import { initKeys } from "./keys.js";
import { nav } from "./nav.js";
import * as notify from "./notify.js";
import { openPalette } from "./palette.js";
import { inbox, load, onChange, overdueCount, popUndo, S } from "./store.js";
import { fmtTime, h, setTZ, toast } from "./util.js";
import { view as home } from "./views/home.js";
import { view as inboxView } from "./views/inbox.js";
import { flushNow, view as notes } from "./views/notes.js";
import { view as services } from "./views/services.js";
import { view as tasks } from "./views/tasks.js";

const VIEWS = { home, notes, tasks, inbox: inboxView, services };
const ORDER = ["home", "notes", "tasks", "inbox", "services"];
const $ = (id) => document.getElementById(id);

let cur = null, curName = "", routing = 0;

// ---- navigation ---------------------------------------------------------------------------------

function parseHash() {
  const [, name, arg] = location.hash.split("/");
  return [VIEWS[name] ? name : "home", arg === undefined ? null : decodeURIComponent(arg)];
}

async function route() {
  const my = ++routing;
  const [name, arg] = parseHash();
  const next = VIEWS[name];
  if (next === cur) await cur.show?.(arg);
  else {
    await cur?.unmount?.();
    if (my !== routing) return;
    cur = next; curName = name;
    await cur.mount($("view"), arg);
  }
  chrome();
  $("view").scrollTop = 0;
}

nav.go = (name, arg) => {
  const hash = `#/${name}${arg != null ? "/" + encodeURIComponent(arg) : ""}`;
  if (location.hash === hash) route(); else location.hash = hash;
};
nav.capture = openCapture;
nav.palette = openPalette;
nav.hintsChanged = () => chrome();

// ---- chrome (tabs, counters, hint line) ------------------------------------------------------------

function chrome() {
  document.title = `tspa · ${curName}`;
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.v === curName));
  const nIn = inbox().length, od = overdueCount();
  $("inbox-count").textContent = nIn ? nIn : "";
  const chip = $("overdue");
  chip.textContent = od ? `${od} overdue` : "";
  chip.hidden = !od;
  const down = S.widgets.filter((w) => S.wstate[w.id] && !S.wstate[w.id].up).length;
  const dchip = $("down");
  dchip.textContent = down ? `${down} down` : "";
  dchip.hidden = !down;
  const base = [["Space", "capture"], ["/", "search"], ["1-5", "views"], ["?", "help"]];
  const mine = cur?.hints?.() || [];
  $("hints").replaceChildren(...[...mine, ...base].map(([k, l]) => h("span", { class: "hint" }, h("kbd", {}, k), " ", l)));
  const s = notify.status();
  $("notifybtn").textContent = s === "on" ? "🔔" : "🔕";
  $("notifybtn").title = `notifications: ${s} (click to ${s === "on" ? "turn off" : "turn on"})`;
}

function tick() { $("clock").textContent = fmtTime(new Date().toISOString()); }

// ---- keys -----------------------------------------------------------------------------------------

function globals(e) {
  if (e.key === " ") { openCapture(); return true; }
  if (e.key === "/") { openPalette(); return true; }
  if (e.key === "?") { openHelp(); return true; }
  if (e.key === "u") { popUndo().then((l) => toast(l ? `undone: ${l}` : "nothing to undo")).catch((er) => toast(er.message, "warn")); return true; }
  if (e.key.length === 1 && e.key >= "1" && e.key <= "5") { nav.go(ORDER[+e.key - 1]); return true; }
  if (e.key === "Escape" && curName !== "home") { nav.go("home"); return true; }
  return false;
}

// ---- commands (palette ">") -----------------------------------------------------------------------

const theme = () => document.documentElement.dataset.theme;
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("tspa.theme", t); } catch (_) {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f6f6f2" : "#0b0f14");
}

nav.commands = () => [
  { label: "New note", sub: "n in notes", run: () => newNote() },
  { label: "New task", run: () => itemForm(null, "task") },
  { label: "New reminder", run: () => itemForm(null, "rem") },
  { label: "Add a service to the dashboard", run: () => widgetForm() },
  { label: "Refresh services now", run: () => api.post("/api/widgets/refresh").then(() => toast("refreshed")) },
  { label: `Switch to ${theme() === "light" ? "dark" : "light"} theme`, keys: "theme dark light", run: () => setTheme(theme() === "light" ? "dark" : "light") },
  { label: "Toggle notifications", keys: "bell push", run: async () => { notify.status() === "on" ? await notify.disable() : await notify.enable(); chrome(); } },
  { label: "Keyboard help", sub: "?", run: openHelp },
  { label: "Log out", run: logout },
];

async function logout() {
  await fetch("/logout", { method: "POST", credentials: "same-origin" });
  location.href = "/login";
}

// ---- boot -------------------------------------------------------------------------------------------

async function boot() {
  try { setTheme(localStorage.getItem("tspa.theme") || "dark"); } catch (_) { setTheme("dark"); }
  const cfg = await api.get("/api/config");
  setTZ(cfg.tz);
  S.cfg = cfg;
  await load();

  document.querySelectorAll("#tabs a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); nav.go(a.dataset.v); }));
  $("capbtn").addEventListener("click", () => openCapture());
  $("searchbtn").addEventListener("click", () => openPalette());
  $("helpbtn").addEventListener("click", openHelp);
  $("notifybtn").addEventListener("click", async () => { notify.status() === "on" ? await notify.disable() : await notify.enable(); chrome(); });
  $("overdue").addEventListener("click", () => nav.go("tasks"));
  $("down").addEventListener("click", () => nav.go("services"));
  $("fab").addEventListener("click", () => openCapture());

  initKeys({ globals, view: () => cur });
  onChange(() => { cur?.render?.(); chrome(); });
  window.addEventListener("hashchange", route);
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("beforeunload", flushNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushNow(); else load().catch(() => {}); });

  await notify.init(cfg, chrome);
  tick(); setInterval(tick, 20000);
  setInterval(() => { if (!document.hidden) cur?.render?.(); }, 60000); // keep "in 5m" style labels fresh

  await route();
  document.body.dataset.ready = "1";

  // opened from a phone share sheet / shortcut:  /?add=text   or the PWA share target (?title=&text=&url=)
  const q = new URLSearchParams(location.search);
  const shared = q.get("add") || [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join(" ");
  if (shared || q.has("capture")) { history.replaceState(null, "", location.pathname + location.hash); openCapture(shared); }
}

boot().catch((e) => {
  console.error(e);
  document.body.dataset.ready = "error";
  toast("couldn't start: " + e.message, "warn");
});
