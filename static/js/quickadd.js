import { api } from "./api.js";
import { load } from "./store.js";
import { openModal } from "./modal.js";
import { h, toast, fmtDate, fmtTime, TZ } from "./util.js";

const KINDS = [null, "todo", "assignment", "reminder", "note", "stream", "project"];
const LABEL = { todo: "TODO", assignment: "DUE", reminder: "REMIND", note: "NOTE", stream: "STREAM", project: "PROJECT" };

function when(iso) {
  const ts = Date.parse(iso), end = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ts) === "23:59";
  return fmtDate(iso) + (end ? "" : " " + fmtTime(iso));
}

export function openQuickAdd(initial = "") {
  let kindIdx = 0, last = null, seq = 0, asked = false, timer;
  const input = h("input", { class: "qa-input", autocomplete: "off", spellcheck: "false", placeholder: "Bio project due 10/24   ·   va state test 2hr   ·   n: idea   ·   > thought" });
  const preview = h("div", { class: "preview" });
  const hint = h("div", { class: "mhint" },
    h("span", {}, h("b", {}, "Enter"), " add"), h("span", {}, h("b", {}, "Tab"), " change type"),
    h("span", {}, h("b", {}, "Esc"), " cancel"), h("span", { class: "dim" }, "prefixes: t: a: r: n: i: p: > · #project · !!"));
  input.value = initial;

  function show(r, note) {
    if (!r) { preview.replaceChildren(h("span", { class: "dim" }, "type something…")); return; }
    const chips = [];
    if (r.due_at) chips.push(h("span", { class: "yellow" }, "due " + when(r.due_at)));
    if (r.fire_at) chips.push(h("span", { class: "yellow" }, "at " + when(r.fire_at) + (r.kind === "reminder" ? "" : "")));
    if (r.project) chips.push(h("span", { class: "blue" }, "#" + r.project));
    if (r.priority) chips.push(h("span", { class: "red" }, "!".repeat(r.priority)));
    if (r.kind === "reminder" && !r.fire_at) chips.push(h("span", { class: "red" }, "no time found — add e.g. “in 2h” or “at 3pm”"));
    if (r.source === "ai") chips.push(h("span", { class: "magenta" }, "[ai]"));
    if (note) chips.push(h("span", { class: "dim" }, note));
    preview.replaceChildren(h("div", {}, h("span", { class: "badge " + r.kind }, LABEL[r.kind]), h("b", {}, r.title || "…")), h("div", { class: "chips" }, chips));
  }

  async function refresh(useAI = false) {
    const text = input.value.trim(), my = ++seq;
    if (!text) { last = null; show(null); return null; }
    try {
      const r = await api.post("/api/quickadd/preview", { text, force_kind: KINDS[kindIdx], use_ai: useAI });
      if (my !== seq) return null;
      last = r;
      show(r, r.low_confidence && r.ai_available ? "unsure — Enter asks AI" : r.low_confidence ? "unsure" : "");
      return r;
    } catch (e) { if (my === seq) preview.replaceChildren(h("span", { class: "red" }, e.message)); return null; }
  }

  async function submit() {
    if (!input.value.trim()) return;
    clearTimeout(timer);
    let r = await refresh(false);
    if (!r) return;
    if (r.low_confidence && r.ai_available && !asked) {
      asked = true;
      preview.append(h("div", { class: "magenta" }, "asking AI…"));
      const smart = await refresh(true);
      if (smart && smart.source === "ai") return; // show it; Enter again to accept
      r = last;
    }
    if (r.kind === "reminder" && !r.fire_at) { toast("reminder needs a time, e.g. “in 2h” or “at 3pm”", "warn"); return; }
    try {
      await api.post("/api/quickadd/commit", r);
      m.close();
      toast(`${LABEL[r.kind].toLowerCase()} added: ${r.title}`);
      await load();
    } catch (e) { toast(e.message, "err"); }
  }

  input.addEventListener("input", () => { asked = false; clearTimeout(timer); timer = setTimeout(() => refresh(false), 120); });
  const m = openModal("quick add", h("div", {}, input, preview, hint), {
    onKey: (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      else if (e.key === "Tab") { e.preventDefault(); kindIdx = (kindIdx + (e.shiftKey ? -1 : 1) + KINDS.length) % KINDS.length; asked = false; refresh(false); }
    },
  });
  show(null);
  if (initial) refresh(false);
}
