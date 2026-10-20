// Row / tile renderers shared by several views.
import { countdown, dueInfo, fmtStamp, h } from "../util.js";
import { projectName } from "../store.js";
import { toggleItem } from "../actions.js";

export function agendaRow(it) {
  const o = it.obj, done = it.type === "task" && !!o.done_at;
  const rem = it.type === "rem";
  let when = { text: "", cls: "dim" };
  if (rem) {
    const ms = Date.parse(o.fire_at) - Date.now();
    when = ms < 0 ? { text: "now", cls: "red" } : ms < 864e5 ? { text: countdown(o.fire_at), cls: "yellow" } : dueInfo(o.fire_at);
  } else if (o.due_at) when = dueInfo(o.due_at, done);
  const proj = !rem && o.project_id ? projectName(o.project_id) : "";
  return h("div", { class: "item" + (done ? " done" : "") },
    h("button", { class: "chk" + (rem ? " rem" : "") + (done ? " on" : ""), tabindex: "-1", "data-no-activate": "1", title: rem ? "dismiss" : done ? "reopen" : "mark done", onclick: () => toggleItem(it) }, rem ? "⏰" : done ? "✔" : ""),
    h("span", { class: "t" }, rem ? o.text : o.title),
    !rem && o.kind === "assignment" ? h("span", { class: "chip blue" }, "school") : null,
    proj ? h("span", { class: "chip" }, "#" + proj) : null,
    !rem && o.priority ? h("span", { class: "prio p" + o.priority }, "!".repeat(o.priority)) : null,
    h("span", { class: "due " + when.cls }, when.text));
}

export function fmtVal(v, fmt) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (fmt === "bytes" && Number.isFinite(n)) {
    const u = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0, x = n;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${u[i]}`;
  }
  if (fmt === "pct" && Number.isFinite(n)) return `${Math.round(n * 10) / 10}%`;
  if (fmt === "dur" && Number.isFinite(n)) {
    const d = Math.floor(n / 86400), hr = Math.floor((n % 86400) / 3600), m = Math.floor((n % 3600) / 60);
    return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
  }
  if (fmt !== "raw" && Number.isFinite(n) && typeof v !== "boolean" && v !== "") return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return String(v);
}

export const health = (st) => (!st ? "unknown" : st.up ? "up" : "down");

export function histBar(st) {
  const hist = st?.history || [];
  return h("span", { class: "hist", title: `${hist.filter(Boolean).length}/${hist.length} checks up` },
    hist.slice(-24).map((x) => h("i", { class: x ? "u" : "d" })));
}

export function widgetRow(w, st) {
  const right = w.kind === "stat" && st?.up
    ? st.values.slice(0, 2).map((v) => h("span", { class: "val" }, h("span", { class: "dim" }, v.label + " "), fmtVal(v.value, v.fmt)))
    : [h("span", { class: "dim" }, st ? (st.up ? `${st.ms}ms` : st.error || "down") : "…")];
  return h("div", { class: "item wrow" }, h("span", { class: "dot " + health(st) }), h("span", { class: "t" }, w.name), ...right);
}

export function widgetCard(w, st) {
  const body = w.kind === "stat"
    ? h("div", { class: "vals" }, (st?.values || []).map((v) => h("div", { class: "stat" }, h("div", { class: "big" }, fmtVal(v.value, v.fmt)), h("div", { class: "lbl" }, v.label))))
    : h("div", { class: "big " + health(st) }, st ? (st.up ? "UP" : "DOWN") : "…");
  return h("div", { class: "card row health-" + health(st) },
    h("div", { class: "card-head" }, h("span", { class: "dot " + health(st) }), h("b", {}, w.name), h("span", { class: "dim right" }, st ? (st.up ? `${st.ms} ms` : st.error) : "checking…")),
    body,
    st && w.kind === "stat" && !st.up ? h("div", { class: "bad" }, st.error || "down") : null,
    histBar(st),
    st ? h("div", { class: "dim small" }, "checked " + fmtStamp(st.at)) : null);
}

/** Nearest element in a direction (for arrow-key movement across a 2D layout). Edges, not centers, so a tall panel
 *  next to two stacked ones goes to the one it lines up with at the top. */
export function neighbor(els, from, dir) {
  const a = els[from]?.getBoundingClientRect();
  if (!a) return -1;
  let best = -1, bestScore = Infinity;
  els.forEach((el, j) => {
    if (j === from || !el.offsetParent) return;
    const b = el.getBoundingClientRect();
    const main = dir === "right" ? b.left - a.right : dir === "left" ? a.left - b.right : dir === "down" ? b.top - a.bottom : a.top - b.bottom;
    if (main < -4) return;
    const cross = dir === "left" || dir === "right" ? Math.abs(b.top - a.top) : Math.abs(b.left - a.left);
    const score = Math.max(main, 0) + cross * 2;
    if (score < bestScore) { bestScore = score; best = j; }
  });
  return best;
}
