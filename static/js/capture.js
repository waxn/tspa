// Capture: Space from anywhere, type, Enter. Plain thoughts go to the inbox; anything with a date/prefix becomes the right thing.
import { api } from "./api.js";
import { load, pushUndo } from "./store.js";
import { modal } from "./ui.js";
import { fill, fmtStamp, h, toast } from "./util.js";

const DRAFT = "tspa.draft";
const KINDS = [null, "todo", "assignment", "reminder", "note", "stream", "project"];
const LABEL = { todo: "todo", assignment: "assignment", reminder: "reminder", note: "note", stream: "thought", project: "project" };
const ROUTE = { todo: "tasks", assignment: "tasks", reminder: "reminders", note: "notes", stream: "stream", project: "projects" };

const store = {
  get() { try { return localStorage.getItem(DRAFT) || ""; } catch (_) { return ""; } },
  set(v) { try { v ? localStorage.setItem(DRAFT, v) : localStorage.removeItem(DRAFT); } catch (_) {} },
};

function describe(p) {
  if (p.thought) return [h("b", {}, "thought"), " → inbox", p.ai ? h("span", { class: "dim" }, "  · AI will tag and suggest where it belongs") : null];
  const when = p.fire_at || p.due_at;
  return [h("b", {}, LABEL[p.kind] || p.kind), " · ", p.title,
    when ? h("span", { class: "yellow" }, "  · " + (p.fire_at ? "remind " : "due ") + fmtStamp(when)) : null,
    p.project ? h("span", { class: "dim" }, "  #" + p.project) : null,
    p.priority ? h("span", { class: "red" }, "  " + "!".repeat(p.priority)) : null];
}

export function openCapture(initial = "") {
  let kindIdx = 0, seq = 0, timer, saving = false;
  const input = h("textarea", { class: "cap-input", rows: "1", autocomplete: "off", spellcheck: "true", placeholder: "what's on your mind?" });
  const kindChip = h("button", { type: "button", class: "chip", title: "Tab changes the type", onclick: () => cycle(1) });
  const preview = h("div", { class: "cap-preview" });
  const err = h("div", { class: "err" });
  input.value = initial || store.get();

  const kind = () => KINDS[kindIdx];
  function fit() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 220) + "px"; }
  function paintKind() { kindChip.textContent = kind() ? LABEL[kind()] : "auto"; kindChip.classList.toggle("on", !!kind()); }
  function cycle(d) { kindIdx = (kindIdx + d + KINDS.length) % KINDS.length; paintKind(); refresh(); }

  function refresh() {
    clearTimeout(timer);
    const text = input.value.trim();
    if (!text) { fill(preview, h("span", { class: "dim" }, "plain text is kept as a thought · “call mom in 2h” → reminder · “bio lab due fri” → assignment · “n: idea” → note · “p: name” → project")); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const p = await api.post("/api/capture/preview", { text, kind: kind() });
        if (my === seq) fill(preview, "→ ", describe(p));
      } catch (_) { /* preview is a nicety; saving still works */ }
    }, 120);
  }

  async function save(keepOpen) {
    const text = input.value.trim();
    if (!text) return o.close();
    if (saving) return;
    saving = true; err.textContent = "";
    try {
      const out = await api.post("/api/capture", { text, kind: kind() });
      store.set("");
      const item = out.item;
      pushUndo("capture", () => api.del(`/api/${ROUTE[out.kind]}/${item.id}`));
      const what = item.title || item.text || item.body || item.name || "";
      toast(`saved → ${out.kind === "stream" ? "inbox" : LABEL[out.kind]}: ${what.slice(0, 60)} · u to undo`);
      load().catch(() => {});
      if (keepOpen) { input.value = ""; fit(); refresh(); input.focus(); } else o.close();
    } catch (e) {
      err.textContent = `couldn't save (${e.message}). Your text is kept — try again.`;
    }
    saving = false;
  }

  const o = modal(h("div", { class: "capture" },
    h("div", { class: "cap-row" }, h("span", { class: "accent" }, "›"), input, kindChip),
    preview, err,
    h("div", { class: "fkeys" }, h("kbd", {}, "Enter"), " save   ", h("kbd", {}, "Shift+Enter"), " new line   ", h("kbd", {}, "Tab"), " type   ", h("kbd", {}, "Alt+Enter"), " save & add another   ", h("kbd", {}, "Esc"), " close (text is kept)")),
  {
    cls: "top",
    onKey(e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { save(e.altKey || e.ctrlKey); return true; }
      if (e.key === "Tab") { cycle(e.shiftKey ? -1 : 1); return true; }
      return false;
    },
  });
  input.addEventListener("input", () => { store.set(input.value); fit(); refresh(); });
  paintKind(); fit(); refresh();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  return o;
}
