// "/" — jump to anything: notes, headings inside notes, tasks, thoughts, views, commands.
//   #text  headings only      >text  commands only
import { editItem } from "./actions.js";
import { headingsOf } from "./editor.js";
import { nav } from "./nav.js";
import { agenda, S } from "./store.js";
import { thoughtTitle } from "./actions.js";
import { modal } from "./ui.js";
import { fmtStamp, h } from "./util.js";

const VIEW_ENTRIES = [["home", "1"], ["notes", "2"], ["tasks", "3"], ["inbox", "4"], ["services", "5"]];

function entries(mode) {
  const out = [];
  if (mode !== "head") for (const c of nav.commands()) out.push({ type: "cmd", label: c.label, sub: c.sub || "", run: c.run, hay: c.label + " " + (c.keys || "") });
  if (mode === "cmd") return out;
  if (mode === "all") {
    for (const [v, k] of VIEW_ENTRIES) out.push({ type: "go", label: `Go to ${v}`, sub: `key ${k}`, run: () => nav.go(v), hay: v });
    for (const n of S.notes) out.push({ type: "note", label: n.title || "Untitled", sub: fmtStamp(n.updated_at), body: n.body, run: () => nav.go("notes", n.id), hay: n.title, recent: n.updated_at });
    for (const it of agenda({ showDone: true })) {
      const o = it.obj;
      out.push({ type: it.type === "rem" ? "reminder" : "task", label: it.type === "rem" ? o.text : o.title, sub: it.at ? fmtStamp(it.at) : "", run: () => editItem(it), hay: it.type === "rem" ? o.text : o.title + " " + o.notes });
    }
    for (const e of S.stream) out.push({ type: "thought", label: thoughtTitle(e), sub: fmtStamp(e.created_at), body: e.body, run: () => nav.go("inbox"), hay: e.body + " " + e.tags });
  }
  for (const n of S.notes) {
    for (const hd of headingsOf(n.body)) out.push({ type: "heading", label: hd.text, sub: `${"#".repeat(hd.level)} in ${n.title || "Untitled"}`, level: hd.level, hay: hd.text + " " + n.title, run: () => { nav.opts = { block: hd.i }; nav.go("notes", n.id); } });
  }
  return out;
}

function snippet(body, words) {
  const low = body.toLowerCase();
  const at = low.indexOf(words[0]);
  if (at < 0) return "";
  return (at > 30 ? "…" : "") + body.slice(Math.max(0, at - 30), at + 70).replace(/\s+/g, " ");
}

export function search(q) {
  const mode = q.startsWith("#") ? "head" : q.startsWith(">") ? "cmd" : "all";
  const words = (mode === "all" ? q : q.slice(1)).toLowerCase().split(/\s+/).filter(Boolean);
  const all = entries(mode);
  if (!words.length) {
    if (mode !== "all") return all.slice(0, 40);
    const notes = all.filter((x) => x.type === "note").sort((a, b) => b.recent.localeCompare(a.recent)).slice(0, 6);
    return [...notes, ...all.filter((x) => x.type === "cmd" || x.type === "go")];
  }
  const scored = [];
  for (const x of all) {
    const label = x.label.toLowerCase(), hay = (x.hay || x.label).toLowerCase(), body = (x.body || "").toLowerCase();
    let score = 0, ok = true;
    for (const w of words) {
      if (label.startsWith(w)) score += 5;
      else if (label.includes(w)) score += 3;
      else if (hay.includes(w)) score += 2;
      else if (body.includes(w)) score += 1;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (x.type === "heading") score += 0.5;
    scored.push({ ...x, score, snip: body && !label.includes(words[0]) ? snippet(x.body, words) : "" });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 40);
}

export function openPalette(initial = "") {
  let results = [], sel = 0;
  const input = h("input", { class: "pal-input", placeholder: "search notes, headings, tasks…   # headings   > commands", autocomplete: "off", spellcheck: "false", value: initial });
  const list = h("div", { class: "pal-list" });

  function paint() {
    list.replaceChildren(...(results.length ? results.map((r, n) => h("div", {
      class: "pal-row" + (n === sel ? " sel" : ""),
      onmousedown: (e) => { e.preventDefault(); sel = n; run(); },
    }, h("span", { class: "ptype " + r.type }, r.type),
      h("span", { class: "plabel" + (r.level ? " lv" + r.level : "") }, r.label),
      h("span", { class: "psub dim" }, r.snip || r.sub))) : [h("div", { class: "empty" }, "nothing matches")]));
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
  function update() { results = search(input.value); sel = Math.min(sel, Math.max(0, results.length - 1)); paint(); }
  function run() { const r = results[sel]; if (!r) return; o.close(); setTimeout(() => r.run(), 0); }

  const o = modal(h("div", { class: "palette" }, input, list), {
    cls: "top",
    onKey(e) {
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) { sel = Math.min(results.length - 1, sel + 1); paint(); return true; }
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) { sel = Math.max(0, sel - 1); paint(); return true; }
      if (e.key === "Enter") { run(); return true; }
      return false;
    },
  });
  input.addEventListener("input", () => { sel = 0; update(); });
  update();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  return o;
}
