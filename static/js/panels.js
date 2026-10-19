import { api } from "./api.js";
import { S, load, projectName } from "./store.js";
import { openForm } from "./forms.js";
import { confirmBox } from "./modal.js";
import { h, dueInfo, countdown, fmtStamp, fmtTime, fmtDate, dayDiff, toast } from "./util.js";

const needle = () => S.filter.trim().toLowerCase();
const hit = (...s) => !needle() || s.filter(Boolean).join(" ").toLowerCase().includes(needle());
const t = (iso) => (iso ? Date.parse(iso) : Infinity);
const byDue = (a, b) => t(a.due_at) - t(b.due_at) || b.priority - a.priority || a.id - b.id;
const bangs = (n) => (n ? h("span", { class: n === 3 ? "red" : n === 2 ? "yellow" : "cyan" }, "!".repeat(n)) : null);
const done = (x) => !!x.done_at;

function taskItems(kind) {
  const all = S.tasks.filter((x) => x.kind === kind && hit(x.title, projectName(x.project_id)));
  const open = all.filter((x) => !done(x)).sort(byDue);
  return S.showDone ? [...open, ...all.filter(done).sort((a, b) => t(b.done_at) - t(a.done_at))] : open;
}
const tagFor = (x) => (x.project_id && projectName(x.project_id) ? h("span", { class: "blue" }, "#" + projectName(x.project_id)) : null);

function taskRow(x) {
  const d = dueInfo(x.due_at, done(x));
  return h("div", { class: "row" },
    h("span", { class: "box", "data-act": "toggle", title: "toggle done" }, done(x) ? "[x]" : "[ ]"),
    bangs(x.priority),
    h("span", { class: "t" + (done(x) ? " strike" : "") }, x.title),
    tagFor(x),
    h("span", { class: "r " + d.cls }, d.text));
}

const ago = (iso) => countdown(iso);

export const PANELS = [
  {
    id: "todos", key: "1", name: "todos",
    items: () => taskItems("todo"), row: taskRow,
    meta: (items) => `${items.filter((x) => !done(x)).length} open`,
    hints: [["x", "done"], ["e", "edit"], ["n", "new"], ["d", "delete"]],
    toggle: (x) => api.patch("/api/tasks/" + x.id, { done_at: done(x) ? null : new Date().toISOString() }),
    edit: (x) => openForm("task", x), create: () => openForm("task", null, { kind: "todo" }),
    del: (x) => api.del("/api/tasks/" + x.id), label: (x) => x.title,
  },
  {
    id: "due", key: "2", name: "due",
    items: () => taskItems("assignment"), row: taskRow,
    meta: (items) => { const o = items.filter((x) => !done(x) && x.due_at && Date.parse(x.due_at) < Date.now()).length; return o ? `${o} overdue` : `${items.filter((x) => !done(x)).length} open`; },
    hints: [["x", "done"], ["e", "edit"], ["n", "new"], ["d", "delete"]],
    toggle: (x) => api.patch("/api/tasks/" + x.id, { done_at: done(x) ? null : new Date().toISOString() }),
    edit: (x) => openForm("task", x), create: () => openForm("task", null, { kind: "assignment" }),
    del: (x) => api.del("/api/tasks/" + x.id), label: (x) => x.title,
  },
  {
    id: "projects", key: "3", name: "projects",
    items: () => S.projects.filter((p) => hit(p.name, p.description) && (S.showDone || p.status !== "done")),
    row: (p) => {
      const ts = S.tasks.filter((x) => x.project_id === p.id), n = ts.length, d = ts.filter(done).length, w = 8;
      const fill = n ? Math.round((d / n) * w) : 0;
      return h("div", { class: "row" },
        h("span", { class: "t" + (p.status === "done" ? " strike" : "") }, p.name),
        h("span", { class: "bar " + (p.status === "paused" ? "yellow" : "accent") }, "█".repeat(fill) + "░".repeat(w - fill)),
        h("span", { class: "r" }, n ? `${d}/${n}` : "–"),
        p.status !== "active" && h("span", { class: "r" }, p.status));
    },
    meta: (items) => `${items.length}`,
    hints: [["x", "done/reopen"], ["e", "edit"], ["n", "new"], ["d", "delete"]],
    toggle: (p) => api.patch("/api/projects/" + p.id, { status: p.status === "done" ? "active" : "done" }),
    edit: (p) => openForm("project", p), create: () => openForm("project"),
    del: (p) => api.del("/api/projects/" + p.id), label: (p) => p.name,
  },
  {
    id: "notes", key: "4", name: "notes",
    items: () => S.notes.filter((n) => hit(n.title, n.body)).sort((a, b) => b.pinned - a.pinned || Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    row: (n) => h("div", { class: "row" },
      h("span", { class: n.pinned ? "yellow" : "dim" }, n.pinned ? "*" : "·"),
      h("span", { class: "t" }, n.title),
      n.project_id && projectName(n.project_id) && h("span", { class: "blue" }, "#" + projectName(n.project_id)),
      h("span", { class: "r" }, fmtDate(n.updated_at))),
    meta: (items) => `${items.length}`,
    hints: [["Enter", "open"], ["x", "pin"], ["n", "new"], ["d", "delete"]],
    toggle: (n) => api.patch("/api/notes/" + n.id, { pinned: !n.pinned }),
    edit: (n) => openForm("note", n), create: () => openForm("note"),
    del: (n) => api.del("/api/notes/" + n.id), label: (n) => n.title,
  },
  {
    id: "stream", key: "5", name: "stream",
    items: () => S.stream.filter((e) => hit(e.body)),
    row: (e) => h("div", { class: "row" }, h("span", { class: "dim" }, fmtStamp(e.created_at)), h("span", { class: "t" }, e.body)),
    meta: (items) => `${items.length}`,
    hints: [["i", "write"], ["e", "edit"], ["d", "delete"]],
    edit: (e) => openForm("stream", e), create: () => document.getElementById("sinput").focus(),
    del: (e) => api.del("/api/stream/" + e.id), label: (e) => e.body.slice(0, 40),
  },
  {
    id: "reminders", key: "6", name: "reminders",
    items: () => {
      const rs = S.reminders.filter((r) => hit(r.text));
      return [...rs.filter((r) => !r.fired_at), ...rs.filter((r) => r.fired_at).sort((a, b) => Date.parse(b.fire_at) - Date.parse(a.fire_at)).slice(0, 5)];
    },
    row: (r) => h("div", { class: "row" },
      h("span", { class: r.fired_at ? "dim" : "yellow" }, r.fired_at ? "✓" : "◷"),
      h("span", { class: "t" + (r.fired_at ? " strike" : "") }, r.text),
      h("span", { class: "dim" }, (dayDiff(r.fire_at) === 0 ? "" : fmtDate(r.fire_at) + " ") + fmtTime(r.fire_at)),
      h("span", { class: "r " + (r.fired_at ? "" : "yellow"), style: "min-width:9ch;text-align:right" }, ago(r.fire_at))),
    meta: (items) => `${items.filter((r) => !r.fired_at).length} pending`,
    hints: [["x", "dismiss"], ["e", "edit"], ["n", "new"], ["d", "delete"]],
    toggle: (r) => (r.fired_at ? api.del("/api/reminders/" + r.id) : api.patch("/api/reminders/" + r.id, { fired_at: new Date().toISOString() })),
    edit: (r) => openForm("reminder", r), create: () => openForm("reminder", null, {}),
    del: (r) => api.del("/api/reminders/" + r.id), label: (r) => r.text,
  },
];
export const byId = Object.fromEntries(PANELS.map((p) => [p.id, p]));

// ---- UI state + rendering -------------------------------------------------
export const ui = { focus: "todos", sel: Object.fromEntries(PANELS.map((p) => [p.id, 0])), zoom: false };
const cache = {};

export const items = (id) => cache[id] || [];
export const current = () => items(ui.focus)[ui.sel[ui.focus]];

export function render() {
  for (const p of PANELS) {
    const root = document.getElementById("p-" + p.id), list = root.querySelector(".list");
    const its = (cache[p.id] = p.items());
    ui.sel[p.id] = Math.max(0, Math.min(ui.sel[p.id], its.length - 1));
    root.classList.toggle("focus", p.id === ui.focus);
    root.querySelector(".pmeta").textContent = p.meta(its);
    const rows = its.map((it, i) => {
      const row = p.row(it);
      row.classList.toggle("sel", i === ui.sel[p.id]);
      row.dataset.i = i;
      return row;
    });
    list.replaceChildren(...(rows.length ? rows : [h("div", { class: "empty" }, S.filter ? "no matches" : "nothing here — press " + (p.id === "stream" ? "i" : "a") + " to add")]));
    if (p.id === ui.focus) list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
  document.getElementById("grid").classList.toggle("zoom", ui.zoom);
  const overdue = S.tasks.filter((x) => !done(x) && x.due_at && Date.parse(x.due_at) < Date.now()).length;
  const od = document.getElementById("overdue");
  od.textContent = `overdue: ${overdue}`;
  od.className = "chip" + (overdue ? " bad" : "");
  const pend = S.reminders.filter((r) => !r.fired_at).length;
  document.getElementById("upcoming").textContent = `reminders: ${pend}`;
  const fc = document.getElementById("filterchip");
  fc.hidden = !S.filter;
  fc.textContent = "/" + S.filter + " ✕";
  renderHints();
}

/** Move focus/selection by toggling classes only — no row rebuild, so dblclick targets survive. */
function paintSel() {
  for (const p of PANELS) {
    const root = document.getElementById("p-" + p.id);
    root.classList.toggle("focus", p.id === ui.focus);
    root.querySelectorAll(".row").forEach((r) => r.classList.toggle("sel", +r.dataset.i === ui.sel[p.id]));
  }
  renderHints();
}

export function setFocus(id) { ui.focus = id; render(); }
export function move(d) {
  const n = items(ui.focus).length;
  ui.sel[ui.focus] = n ? Math.max(0, Math.min(n - 1, ui.sel[ui.focus] + d)) : 0;
  render();
}
export function moveTo(i) { ui.sel[ui.focus] = i === Infinity ? Math.max(0, items(ui.focus).length - 1) : i; render(); }
export function cycle(d) {
  const i = PANELS.findIndex((p) => p.id === ui.focus);
  setFocus(PANELS[(i + d + PANELS.length) % PANELS.length].id);
}

async function run(fn) { try { await fn(); await load(); } catch (e) { toast(e.message, "err"); } }
export const act = {
  edit: () => { const x = current(); if (x) byId[ui.focus].edit(x); },
  create: () => byId[ui.focus].create(),
  toggle: () => { const x = current(), p = byId[ui.focus]; if (x && p.toggle) run(() => p.toggle(x)); },
  async del() {
    const x = current(), p = byId[ui.focus];
    if (x && (await confirmBox(`Delete "${p.label(x)}"?`))) run(() => p.del(x));
  },
};

// context-sensitive footer; each hint is a button that fires the same action as its key
export const GLOBAL_HINTS = [["a", "add"], ["1-6", "panel"], ["Tab", "next"], ["/", "filter"], ["h", "done"], ["z", "zoom"], ["?", "help"]];
export let onHint = () => {};
export const setHintHandler = (fn) => { onHint = fn; };
function renderHints() {
  const bar = document.getElementById("hints"), p = byId[ui.focus];
  const btn = ([k, l]) => h("button", { onclick: () => onHint(k), title: "click or press " + k }, h("b", {}, k), l);
  bar.replaceChildren(...p.hints.map(btn), h("span", { class: "gap" }), ...GLOBAL_HINTS.map(btn));
}

// ---- mouse ------------------------------------------------------------------
export function wireMouse() {
  for (const p of PANELS) {
    const root = document.getElementById("p-" + p.id), list = root.querySelector(".list");
    // focus on click (not mousedown): re-rendering on mousedown would detach the clicked row
    root.addEventListener("click", () => { if (ui.focus !== p.id) setFocus(p.id); });
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".row");
      if (!row) return;
      ui.focus = p.id;
      ui.sel[p.id] = +row.dataset.i;
      paintSel();
      if (e.target.closest("[data-act=toggle]")) act.toggle();
    });
    list.addEventListener("dblclick", (e) => {
      if (e.target.closest(".row") && !e.target.closest("[data-act]")) act.edit();
    });
  }
}
