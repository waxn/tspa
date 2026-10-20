// Small reusable UI pieces: keyboard-driven list, modal, form, confirm.
import { api } from "./api.js";
import { pushOverlay, popOverlay } from "./keys.js";
import { dueInfo, fmtStamp, fmtTime, h } from "./util.js";

export const kbd = (k) => h("kbd", {}, k);

/**
 * A vertical list with one selected row. Re-render() keeps the selection on the same item (by key).
 * `section(item)` may return a label; a header is drawn whenever it changes.
 */
export function listbox({ el, items, row, section, empty = "nothing here", key = (x) => (x.type || "") + (x.obj?.id ?? x.id), onActivate }) {
  let i = 0, lastKey = null;
  const self = {
    get i() { return i; },
    cur: () => items()[i],
    render() {
      const list = items();
      if (lastKey != null) { const j = list.findIndex((x) => key(x) === lastKey); if (j >= 0) i = j; }
      i = Math.max(0, Math.min(i, list.length - 1));
      lastKey = list[i] ? key(list[i]) : null;
      const kids = [];
      let prev;
      list.forEach((it, n) => {
        const label = section?.(it);
        if (label && label !== prev) kids.push(h("div", { class: "sect" }, label));
        prev = label;
        const r = row(it, n);
        r.classList.add("row");
        r.dataset.n = n;
        r.addEventListener("click", (ev) => {
          if (ev.target.closest("[data-no-activate]")) return;
          i = n; lastKey = key(it); self.paint(); onActivate?.(it, n);
        });
        kids.push(r);
      });
      if (!list.length) kids.push(h("div", { class: "empty" }, empty));
      el.replaceChildren(...kids);
      self.paint();
    },
    paint(scroll = false) {
      el.querySelectorAll(".row").forEach((r) => r.classList.toggle("sel", +r.dataset.n === i));
      if (scroll) el.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
    },
    /** Move by delta; returns false when already at the edge (so the caller can jump to another panel). */
    move(d) {
      const list = items();
      if (!list.length) return false;
      const n = Math.max(0, Math.min(list.length - 1, i + d));
      if (n === i) return false;
      i = n; lastKey = key(list[i]); self.paint(true);
      return true;
    },
    last() { self.to(Math.max(0, items().length - 1)); },
    to(n) { i = n; lastKey = items()[n] ? key(items()[n]) : null; self.paint(true); },
    edge: (d) => (d < 0 ? i === 0 : i >= items().length - 1),
  };
  return self;
}

/** Standard j/k/arrow/g/G handling for a listbox. Returns true if the key was used. */
export function navKeys(lb, e) {
  const k = e.key;
  if (k === "ArrowDown" || k === "j") return lb.move(1) || true;
  if (k === "ArrowUp" || k === "k") return lb.move(-1) || true;
  if (k === "g" && !e.shiftKey) { lb.to(0); return true; }
  if (k === "G") { lb.last(); return true; }
  return false;
}

export function modal(node, { onKey, onClose, wide = false, cls = "" } = {}) {
  const prevFocus = document.activeElement;
  const back = h("div", { class: "overlay" }, h("div", { class: "modal " + cls + (wide ? " wide" : "") }, node));
  let closed = false;
  const o = {
    el: back,
    onKey,
    close() {
      if (closed) return;
      closed = true;
      popOverlay(o);
      back.remove();
      onClose?.();
      if (prevFocus?.isConnected && prevFocus !== document.body) prevFocus.focus?.();
    },
  };
  back.addEventListener("mousedown", (e) => { if (e.target === back) o.close(); });
  document.body.append(back);
  pushOverlay(o);
  return o;
}

export function confirmBox(message, yes = "delete") {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); o.close(); } };
    const o = modal(
      h("div", { class: "confirm" }, h("p", {}, message),
        h("div", { class: "row-btns" },
          h("button", { class: "btn danger", onclick: () => finish(true) }, h("u", {}, yes[0]), yes.slice(1)),
          h("button", { class: "btn", onclick: () => finish(false) }, h("u", {}, "c"), "ancel"))),
      {
        cls: "small",
        onKey(e) {
          if (e.key === "y" || e.key === "Enter" || e.key === yes[0]) { finish(true); return true; }
          if (e.key === "n" || e.key === "c" || e.key === "Escape") { finish(false); return true; }
          return true; // swallow everything else while asking
        },
        onClose: () => finish(false),
      });
    o.el.querySelector(".btn.danger").focus();
  });
}

// ---- natural-language dates in forms --------------------------------------------------------
// "fri 5pm", "in 2 hours", "10/24" are read by the server's capture parser, so every date box accepts plain words.

export async function parseWhen(text, kind) {
  const r = await api.post("/api/capture/preview", { text: `x ${text}`, kind });
  return kind === "reminder" ? r.fire_at : r.due_at;
}

export function whenText(iso) {
  if (!iso) return "";
  const d = dueInfo(iso);
  return /overdue/.test(d.text) ? fmtStamp(iso) : `${d.text}`;
}

/**
 * Modal form. fields: {name, label, type: text|area|select|when|check, value, options, hint, placeholder, kind}
 * onSubmit(values) may be async; throwing shows the message and keeps the form open.
 */
export function formModal({ title, fields, submit = "save", onSubmit, extra, danger }) {
  const inputs = {};
  const err = h("div", { class: "err" });
  const body = fields.map((f) => {
    let inp;
    if (f.type === "area") inp = h("textarea", { rows: f.rows || 4, placeholder: f.placeholder || "" }, f.value || "");
    else if (f.type === "select") {
      inp = h("select", {}, f.options.map((o) => h("option", { value: o.value ?? o, selected: (o.value ?? o) == f.value }, o.label ?? o)));
    } else if (f.type === "check") inp = h("input", { type: "checkbox", checked: !!f.value });
    else inp = h("input", { type: "text", value: f.type === "when" ? whenText(f.value) : (f.value ?? ""), placeholder: f.placeholder || "", autocomplete: "off", spellcheck: "false" });
    inputs[f.name] = inp;
    const note = h("div", { class: "fhint" }, f.hint || "");
    if (f.type === "when") {
      inp.dataset.iso = f.value || "";
      inp.dataset.orig = inp.value;
      let seq = 0;
      inp.addEventListener("input", () => {
        const my = ++seq;
        if (!inp.value.trim()) { inp.dataset.iso = ""; note.textContent = f.hint || ""; return; }
        parseWhen(inp.value, f.kind || "todo").then((iso) => {
          if (my !== seq) return;
          inp.dataset.iso = iso || "";
          note.textContent = iso ? "→ " + whenText(iso) + (iso ? "  (" + fmtTime(iso) + ")" : "") : "can't read that date";
          note.className = "fhint" + (iso ? " ok" : " bad");
        }).catch(() => {});
      });
    }
    return h("label", { class: "field" + (f.type === "check" ? " inline" : "") }, h("span", { class: "flabel" }, f.label), inp, note);
  });

  async function values() {
    const out = {};
    for (const f of fields) {
      const inp = inputs[f.name];
      if (f.type === "check") out[f.name] = inp.checked;
      else if (f.type === "when") {
        if (inp.value === inp.dataset.orig) out[f.name] = f.value || null;
        else if (!inp.value.trim()) out[f.name] = null;
        else {
          const iso = inp.dataset.iso || (await parseWhen(inp.value, f.kind || "todo"));
          if (!iso) throw new Error(`couldn't read "${inp.value}" as a date`);
          out[f.name] = iso;
        }
      } else out[f.name] = inp.value;
    }
    return out;
  }

  let busy = false;
  async function go() {
    if (busy) return;
    busy = true; err.textContent = "";
    try { await onSubmit(await values()); o.close(); } catch (e) { err.textContent = e.message; }
    busy = false;
  }

  const form = h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); go(); } },
    h("div", { class: "mtitle" }, title), body, extra || null, err,
    h("div", { class: "row-btns" },
      h("button", { class: "btn primary", type: "submit" }, submit),
      h("button", { class: "btn", type: "button", onclick: () => o.close() }, "cancel"),
      danger ? h("button", { class: "btn danger right", type: "button", onclick: async () => { await danger.run(); o.close(); } }, danger.label) : null),
    h("div", { class: "fkeys" }, kbd("Enter"), " save   ", kbd("Ctrl+Enter"), " save from a text box   ", kbd("Esc"), " cancel"));

  const o = modal(form, {
    onKey(e) {
      if (e.key === "Enter" && e.ctrlKey) { go(); return true; }
      if (e.key === "Enter" && e.target.tagName === "SELECT") { go(); return true; }
      return false;
    },
  });
  o.inputs = inputs;
  o.form = form;
  // Enter in a one-line box submits via the <form>; Enter inside a <textarea> stays a newline.
  (form.querySelector("input[type=text],textarea") || form.querySelector("select"))?.focus();
  form.querySelector("input[type=text]")?.select();
  return o;
}
