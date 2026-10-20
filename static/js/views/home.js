// Home: four btop-style panels. Arrows/hjkl move; Enter opens; x does the obvious thing.
import { api } from "../api.js";
import { acceptSuggestion, deleteItem, deleteThought, editItem, itemForm, keepThought, newNote, suggestionOf, thoughtTitle, toggleItem, triage, widgetForm } from "../actions.js";
import { nav } from "../nav.js";
import { agenda, inbox, mut, notesSorted, S } from "../store.js";
import { listbox, navKeys } from "../ui.js";
import { fmtStamp, h, toast } from "../util.js";
import { agendaRow, neighbor, widgetRow } from "./common.js";

let root, panels = [], focus = 0;
const active = () => panels[focus];

function mkPanel(id, title, key, lbOpts, extra = {}) {
  const list = h("div", { class: "list" });
  const meta = h("span", { class: "pmeta" });
  const el = h("section", { class: "panel", id: "p-" + id, onmousedown: () => setFocus(panels.findIndex((p) => p.id === id)) },
    h("h2", { class: "ptitle" }, title), meta, list);
  const lb = listbox({ el: list, ...lbOpts });
  return { id, el, list, meta, lb, ...extra };
}

const homeAgenda = () => agenda().filter((x) => x.section !== "later" && x.section !== "done");

export const view = {
  title: "home",
  mount(el) {
    root = h("main", { class: "home" });
    el.replaceChildren(root);
    panels = [
      mkPanel("tasks", "tasks", "t", {
        items: homeAgenda, row: agendaRow, section: (it) => it.section, empty: "nothing due. press n to add a task, Space to capture anything.",
        onActivate: (it) => editItem(it),
      }, { more: () => agenda().filter((x) => x.section === "later").length }),
      mkPanel("inbox", "inbox", "i", {
        items: inbox, empty: "inbox zero. Space captures a thought; it lands here.",
        key: (e) => e.id,
        row: (e) => {
          const s = suggestionOf(e);
          return h("div", { class: "item inb" }, h("span", { class: "t" }, thoughtTitle(e)),
            s ? h("span", { class: "chip green", title: "press Enter to accept" }, "→ " + s.kind) : null,
            h("span", { class: "dim" }, fmtStamp(e.created_at)));
        },
        onActivate: (e) => (suggestionOf(e) ? acceptSuggestion(e) : nav.go("inbox")),
      }),
      mkPanel("notes", "notes", "o", {
        items: () => notesSorted().slice(0, 30), empty: "no notes yet. press n.", key: (n) => n.id,
        row: (n) => h("div", { class: "item" }, h("span", { class: "pin" }, n.pinned ? "★" : ""), h("span", { class: "t" + (n.title ? "" : " dim") }, n.title || "Untitled"), h("span", { class: "dim" }, fmtStamp(n.updated_at))),
        onActivate: (n) => nav.go("notes", n.id),
      }),
      mkPanel("services", "services", "s", {
        items: () => S.widgets, empty: "no services yet. press n to add one (up/down checks, API stats).", key: (w) => w.id,
        row: (w) => widgetRow(w, S.wstate[w.id]),
        onActivate: () => nav.go("services"),
      }),
    ];
    const grid = h("div", { class: "hgrid" }, panels.map((p) => p.el));
    root.append(grid);
    focus = Math.min(focus, panels.length - 1);
    view.render();
  },
  unmount() { panels = []; },
  render() {
    if (!panels.length) return;
    for (const p of panels) p.lb.render();
    const [pt, pi, pn, ps] = panels;
    const all = agenda();
    pt.meta.textContent = `${all.filter((x) => x.section === "overdue").length || "no"} overdue · ${pt.more()} later`;
    pi.meta.textContent = `${inbox().length} to sort`;
    pn.meta.textContent = `${S.notes.length}`;
    const down = S.widgets.filter((w) => S.wstate[w.id] && !S.wstate[w.id].up).length;
    ps.meta.textContent = S.widgets.length ? (down ? `${down} down` : "all up") : "";
    ps.meta.className = "pmeta" + (down ? " bad" : "");
    paintFocus();
  },
  hints() {
    const base = [["←↑↓→", "move"], ["Enter", "open"]];
    switch (active()?.id) {
      case "tasks": return [...base, ["x", "done"], ["e", "edit"], ["d", "delete"], ["n", "new task"], ["r", "new reminder"]];
      case "inbox": return [...base, ["t", "todo"], ["r", "reminder"], ["n", "note"], ["x", "keep"], ["d", "delete"]];
      case "notes": return [...base, ["n", "new note"], ["p", "pin"]];
      default: return [...base, ["n", "add service"], ["r", "refresh"]];
    }
  },
  onKey(e) {
    const p = active();
    if (!p) return false;
    const k = e.key;
    const dir = { ArrowLeft: "left", h: "left", ArrowRight: "right", l: "right" }[k];
    if (dir) return jump(dir), true;
    if (k === "Tab") { setFocus((focus + (e.shiftKey ? -1 : 1) + panels.length) % panels.length); return true; }
    if (k === "ArrowDown" || k === "j" || k === "ArrowUp" || k === "k") {
      const d = k === "ArrowDown" || k === "j" ? 1 : -1;
      if (!p.lb.move(d)) jump(d > 0 ? "down" : "up");
      return true;
    }
    if (navKeys(p.lb, e)) return true;
    const cur = p.lb.cur();
    if (e.shiftKey && k !== "?") return false;
    if (k === "Enter") { if (cur) activate(p, cur); return true; }
    switch (p.id) {
      case "tasks":
        if (k === "x" && cur) return toggleItem(cur), true;
        if ((k === "e") && cur) return editItem(cur), true;
        if (k === "d" && cur) return deleteItem(cur), true;
        if (k === "n") return itemForm(null, "task"), true;
        if (k === "r") return itemForm(null, "rem"), true;
        break;
      case "inbox":
        if (!cur) break;
        if (k === "t") return triage(cur, "todo"), true;
        if (k === "r") return triage(cur, "reminder"), true;
        if (k === "n") return triage(cur, "note"), true;
        if (k === "x") return keepThought(cur), true;
        if (k === "d") return deleteThought(cur), true;
        break;
      case "notes":
        if (k === "n") return newNote(), true;
        if (k === "p" && cur) return mut(() => api.patch(`/api/notes/${cur.id}`, { pinned: !cur.pinned })), true;
        break;
      case "services":
        if (k === "n") return widgetForm(), true;
        if ((k === "e") && cur) return widgetForm(cur), true;
        if (k === "r") return api.post("/api/widgets/refresh").then(() => toast("refreshed")), true;
        break;
    }
    return false;
  },
};

function activate(p, cur) {
  if (p.id === "tasks") editItem(cur);
  else if (p.id === "inbox") (suggestionOf(cur) ? acceptSuggestion(cur) : nav.go("inbox"));
  else if (p.id === "notes") nav.go("notes", cur.id);
  else nav.go("services");
}

function jump(dir) {
  const j = neighbor(panels.map((p) => p.el), focus, dir);
  if (j >= 0) setFocus(j);
}
function setFocus(i) {
  if (i < 0) return;
  focus = i;
  paintFocus();
  nav.hintsChanged?.();
}
function paintFocus() {
  panels.forEach((p, n) => p.el.classList.toggle("focus", n === focus));
}
