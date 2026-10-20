export let TZ = "America/New_York";
export const setTZ = (z) => { TZ = z; };

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return e;
}

/** replaceChildren that skips null/false (a bare null would render as the text "null"). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

const parts = (d, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", ...opts }).formatToParts(d).map((p) => [p.type, p.value]));
const FULL = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" };

const ymd = (d) => { const p = parts(d, FULL); return `${p.year}-${p.month}-${p.day}`; };
export function dayDiff(iso, now = new Date()) {
  return Math.round((Date.parse(ymd(new Date(iso)) + "T00:00Z") - Date.parse(ymd(now) + "T00:00Z")) / 864e5);
}
const fmt = (opts) => (iso) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(new Date(iso));
export const fmtDate = fmt({ weekday: "short", month: "short", day: "numeric" });
export const fmtTime = fmt({ hour: "numeric", minute: "2-digit" });
export const fmtStamp = fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const isEndOfDay = (iso) => { const p = parts(new Date(iso), FULL); return p.hour === "23" && p.minute === "59"; };

/** Human due text + color class. Date-only due dates are stored as 23:59 local. */
export function dueInfo(iso, done = false) {
  if (!iso) return { text: "", cls: "dim" };
  const t = Date.parse(iso), diff = dayDiff(iso), eod = isEndOfDay(iso);
  const clock = eod ? "" : " " + fmtTime(iso);
  if (!done && t < Date.now()) return { text: diff < 0 ? `overdue ${-diff}d` : "overdue", cls: "red" };
  if (diff === 0) return { text: "today" + clock, cls: "yellow" };
  if (diff === 1) return { text: "tomorrow" + clock, cls: "yellow" };
  return { text: fmtDate(iso) + clock, cls: diff <= 7 ? "" : "dim" };
}

export function countdown(iso) {
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000), a = Math.abs(s);
  const d = Math.floor(a / 86400), hh = Math.floor((a % 86400) / 3600), m = Math.floor((a % 3600) / 60);
  const txt = d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : m ? `${m}m` : `${a}s`;
  return s >= 0 ? `in ${txt}` : `${txt} ago`;
}

/** ISO instant -> value for <input type=datetime-local>, in the app timezone. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const p = parts(new Date(iso), FULL);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const offsetMs = (ts) => { const p = parts(new Date(ts), FULL); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000; };
/** 'YYYY-MM-DDTHH:MM' in the app timezone -> ISO instant. */
export function fromLocalInput(v) {
  if (!v) return null;
  const [d, t] = v.split("T"), [y, mo, da] = d.split("-").map(Number), [hh, mm] = t.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, da, hh, mm);
  let ts = wall - offsetMs(wall);
  ts = wall - offsetMs(ts);
  return new Date(ts).toISOString();
}

export function toast(msg, cls = "") {
  const box = document.getElementById("toasts");
  const t = h("div", { class: "toast " + cls }, msg);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove(); // newest few only, never a wall of them
  setTimeout(() => t.remove(), 4500);
}
