// Notes: list | editor | outline. Autosaves; the first thing on screen after opening a note is your cursor.
import { deleteNote, newNote } from "../actions.js";
import { api } from "../api.js";
import { createEditor } from "../editor.js";
import { nav } from "../nav.js";
import { mut, notesSorted, S } from "../store.js";
import { listbox, navKeys } from "../ui.js";
import { fill, fmtStamp, h } from "../util.js";

let root, lb, filter, titleEl, saved, outlineEl, docEl, empty, listEl;
let editor = null, current = null, loadedStamp = "", dirty = false, saveTimer = null, outlineTimer = null, q = "";

const byId = (id) => S.notes.find((n) => n.id === id);
const shown = () => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = notesSorted();
  return words.length ? all.filter((n) => words.every((w) => (n.title + "\n" + n.body).toLowerCase().includes(w))) : all;
};

function setSaved(s) { saved.textContent = s; saved.className = "saved " + (s === "saved" ? "ok" : s === "error — will retry" ? "bad" : ""); }

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || current == null) return;
  const id = current, body = editor.markdown(), title = titleEl.value.trim();
  dirty = false;
  setSaved("saving…");
  try {
    const n = await api.patch(`/api/notes/${id}`, { title, body });
    const i = S.notes.findIndex((x) => x.id === id);
    if (i >= 0) S.notes[i] = n;
    if (id === current) loadedStamp = n.updated_at;
    setSaved("saved");
    lb?.render();
  } catch (e) {
    dirty = true;
    setSaved("error — will retry");
    saveTimer = setTimeout(save, 3000);
  }
}

/** Fire-and-forget save for when the page is going away. */
export function flushNow() {
  if (!dirty || current == null || !editor) return;
  dirty = false;
  fetch(`/api/notes/${current}`, { method: "PATCH", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ title: titleEl.value.trim(), body: editor.markdown() }) });
}

function touch() {
  dirty = true;
  setSaved("editing…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(paintOutline, 300);
}

function paintOutline() {
  const hs = editor && current != null ? editor.headings() : [];
  fill(outlineEl,
    h("div", { class: "olabel" }, "outline"),
    ...(hs.length ? hs.map((x) => h("button", { class: "oitem l" + x.level, onclick: () => editor.jump(x.i) }, x.text || "(empty heading)"))
      : [h("div", { class: "dim small" }, "Type ", h("kbd", {}, "# "), " or ", h("kbd", {}, "## "), " for headings — they show up here and in search.")]));
}

async function closeCurrent() {
  if (current == null) return;
  await save();
  const n = byId(current);
  if (n && !n.title && !n.body.trim() && editor.isEmpty() && !titleEl.value.trim()) {
    await mut(() => api.del(`/api/notes/${n.id}`));
  }
}

async function open(id, { focus = "editor", block = null } = {}) {
  if (id !== current) await closeCurrent();
  const n = byId(id);
  if (!n) { current = null; docEl.hidden = true; empty.hidden = false; return; }
  current = id;
  docEl.hidden = false; empty.hidden = true;
  titleEl.value = n.title;
  editor.load(n.body);
  loadedStamp = n.updated_at;
  dirty = false;
  setSaved("saved");
  pinBtn.textContent = n.pinned ? "★ pinned" : "☆ pin";
  paintOutline();
  lb.render();
  const j = lb.cur()?.id === id ? -1 : shown().findIndex((x) => x.id === id);
  if (j >= 0) lb.to(j);
  if (block != null) editor.jump(block);
  else if (focus === "none") lb.paint(true);
  else if (focus === "title" || (!n.title && editor.isEmpty())) titleEl.focus();
  else editor.focus(0, "start");
}

let pinBtn;

export const view = {
  title: "notes",
  async mount(el, arg) {
    filter = h("input", { class: "filter", placeholder: "filter notes…  (f)", autocomplete: "off", spellcheck: "false" });
    listEl = h("div", { class: "list" });
    const blocks = h("div", { class: "blocks" });
    saved = h("span", { class: "saved" });
    pinBtn = h("button", { class: "chip", onclick: async () => { const n = byId(current); if (n) { await mut(() => api.patch(`/api/notes/${n.id}`, { pinned: !n.pinned })); pinBtn.textContent = n.pinned ? "☆ pin" : "★ pinned"; } } }, "☆ pin");
    titleEl = h("input", { class: "doc-title", placeholder: "Untitled", autocomplete: "off", spellcheck: "true" });
    docEl = h("div", { class: "doc", hidden: true },
      h("div", { class: "doc-head" }, saved, h("span", { class: "spacer" }), pinBtn,
        h("button", { class: "chip", onclick: async () => { const n = byId(current); if (n && (await deleteNote(n))) { current = null; docEl.hidden = true; empty.hidden = false; lb.render(); } } }, "delete")),
      h("div", { class: "scroll" }, titleEl, blocks));
    empty = h("div", { class: "doc-empty" }, h("p", {}, "Pick a note on the left, or press ", h("kbd", {}, "n"), " for a new one."),
      h("p", { class: "dim" }, "In the editor: ", h("kbd", {}, "# "), " heading · ", h("kbd", {}, "- "), " bullet · ", h("kbd", {}, "[] "), " to-do · ", h("kbd", {}, "/"), " menu · ", h("kbd", {}, "Esc"), " back to the list."));
    outlineEl = h("aside", { class: "outline" });
    root = h("main", { class: "notes" },
      h("aside", { class: "nlist panel focus" }, h("h2", { class: "ptitle" }, "notes"), h("div", { class: "nhead" }, filter, h("button", { class: "chip on", onclick: () => newNote() }, "+ new")), listEl),
      h("section", { class: "ndoc" }, empty, docEl), outlineEl);
    el.replaceChildren(root);

    editor = createEditor(blocks, {
      onChange: touch,
      onExit(why) { if (why === "up") titleEl.focus(); else lb.paint(true); },
    });
    lb = listbox({
      el: listEl, items: shown, key: (n) => n.id, empty: "no notes match.",
      row: (n) => h("div", { class: "item nrow" }, h("span", { class: "pin" }, n.pinned ? "★" : ""), h("span", { class: "t" + (n.title ? "" : " dim") }, n.title || "Untitled"), h("span", { class: "dim" }, fmtStamp(n.updated_at).replace(/, \d+:\d+.*/, ""))),
      onActivate: (n) => open(n.id),
    });

    filter.addEventListener("input", () => { q = filter.value; lb.render(); });
    filter.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); lb.move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); lb.move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); const n = lb.cur(); if (n) { filter.blur(); open(n.id); } }
      else if (e.key === "Escape") { e.preventDefault(); if (filter.value) { filter.value = ""; q = ""; lb.render(); } filter.blur(); }
    });
    titleEl.addEventListener("input", touch);
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); editor.focus(0, "start"); }
      else if (e.key === "Escape") { e.preventDefault(); titleEl.blur(); }
    });

    lb.render();
    await view.show(arg);
  },
  async show(arg) {
    const opts = nav.opts || {};
    nav.opts = null;
    if (arg == null) {
      if (current != null && byId(current)) return;
      current = null;
      docEl.hidden = true; empty.hidden = false;
      return;
    }
    await open(+arg, opts);
  },
  async unmount() {
    clearTimeout(outlineTimer);
    await closeCurrent();
    editor?.destroy();
    editor = null; current = null; lb = null;
  },
  render() {
    if (!lb) return;
    lb.render();
    // another device changed the open note and we have nothing unsaved: pick it up
    const n = current != null && byId(current);
    if (n && !dirty && n.updated_at !== loadedStamp && !root.contains(document.activeElement)) {
      titleEl.value = n.title;
      editor.load(n.body);
      loadedStamp = n.updated_at;
      paintOutline();
    }
  },
  hints: () => (current != null
    ? [["j/k", "notes"], ["Enter", "edit"], ["n", "new"], ["p", "pin"], ["d", "delete"], ["f", "filter"], ["o", "outline"], ["in editor: Esc", "back to list"]]
    : [["j/k", "move"], ["Enter", "open"], ["n", "new note"], ["f", "filter"]]),
  onKey(e) {
    const k = e.key;
    if (navKeys(lb, e)) { const n = lb.cur(); if (n && (k === "j" || k === "k" || k.startsWith("Arrow"))) open(n.id, { focus: "none" }); return true; }
    const cur = lb.cur();
    if (k === "Enter" || k === "ArrowRight" || k === "l") { if (cur) open(cur.id, { focus: "editor" }); return !!cur; }
    if (k === "n") return newNote(), true;
    if (k === "f") { filter.focus(); filter.select(); return true; }
    if (k === "p" && cur) return mut(() => api.patch(`/api/notes/${cur.id}`, { pinned: !cur.pinned })).then(() => current === cur.id && (pinBtn.textContent = byId(cur.id)?.pinned ? "★ pinned" : "☆ pin")), true;
    if (k === "d" && cur) {
      deleteNote(cur).then((ok) => { if (ok && current === cur.id) { current = null; docEl.hidden = true; empty.hidden = false; } lb?.render(); });
      return true;
    }
    if (k === "o") { nav.palette("#"); return true; }
    return false;
  },
};
