// Inbox: thoughts you captured and haven't sorted. `h` also shows everything you've kept (your log).
import { acceptSuggestion, deleteThought, keepThought, suggestionOf, thoughtTitle, triage } from "../actions.js";
import { api } from "../api.js";
import { inline } from "../editor.js";
import { inbox, mut, S } from "../store.js";
import { formModal, listbox, navKeys } from "../ui.js";
import { dayDiff, fill, fmtDate, fmtStamp, fmtTime, h } from "../util.js";

let root, lb, detail, head, showAll = false;

const items = () => (showAll ? S.stream : inbox());
const day = (e) => { const d = dayDiff(e.created_at); return d === 0 ? "today" : d === -1 ? "yesterday" : fmtDate(e.created_at); };

function paintDetail() {
  const e = lb.cur();
  if (!e) return fill(detail, h("div", { class: "empty" }, "Nothing selected."));
  const s = suggestionOf(e);
  const body = h("div", { class: "prose" });
  body.innerHTML = inline(e.body);
  fill(detail,
    h("div", { class: "dim small" }, fmtStamp(e.created_at), e.triaged ? " · in your log" : ""),
    e.summary ? h("h3", {}, e.summary) : null,
    body,
    e.tags ? h("div", { class: "tags" }, e.tags.split(" ").map((t) => h("span", { class: "chip" }, "#" + t))) : null,
    s ? h("div", { class: "suggest" }, h("div", { class: "dim small" }, "suggested"),
      h("div", {}, h("b", {}, s.kind), ": ", s.title, (s.due_at || s.fire_at) ? h("span", { class: "dim" }, " · " + fmtStamp(s.due_at || s.fire_at)) : null),
      h("div", { class: "dim small" }, "Enter to accept")) : null,
    h("div", { class: "actions" },
      ["t:todo", "r:reminder", "n:note", "x:keep", "e:edit", "d:delete"].map((a) => {
        const [k, l] = a.split(":");
        return h("button", { class: "btn", onclick: () => act(k, e) }, h("u", {}, k), " ", l);
      })));
}

function act(k, e) {
  if (!e) return false;
  if (k === "t") return triage(e, "todo"), true;
  if (k === "r") return triage(e, "reminder"), true;
  if (k === "n") return triage(e, "note"), true;
  if (k === "x") return keepThought(e), true;
  if (k === "d") return deleteThought(e), true;
  if (k === "e") {
    formModal({ title: "edit thought", fields: [{ name: "body", label: "text", type: "area", rows: 6, value: e.body }],
      onSubmit: (v) => mut(() => api.patch(`/api/stream/${e.id}`, { body: v.body.trim() || e.body })) });
    return true;
  }
  return false;
}

export const view = {
  title: "inbox",
  mount(el) {
    head = h("div", { class: "vhead" });
    const list = h("div", { class: "list" });
    detail = h("aside", { class: "panel detail" });
    root = h("main", { class: "page split" },
      h("div", { class: "col" }, head, h("section", { class: "panel focus" }, h("h2", { class: "ptitle" }, "inbox"), list)),
      detail);
    el.replaceChildren(root);
    lb = listbox({
      el: list, items, key: (e) => e.id, empty: showAll ? "no thoughts yet." : "inbox zero. 🎉",
      section: showAll ? day : undefined,
      row: (e) => {
        const s = suggestionOf(e);
        return h("div", { class: "item inb" + (e.triaged ? " done" : "") }, h("span", { class: "t" }, thoughtTitle(e)),
          s ? h("span", { class: "chip green" }, "→ " + s.kind) : null, h("span", { class: "dim" }, fmtTime(e.created_at)));
      },
      onActivate: () => paintDetail(),
    });
    view.render();
  },
  unmount() {},
  render() {
    if (!lb) return;
    lb.render();
    const n = inbox().length;
    fill(head, h("span", {}, showAll ? `${S.stream.length} thoughts in your log` : `${n} to sort`),
      h("button", { class: "chip" + (showAll ? " on" : ""), onclick: () => { showAll = !showAll; view.mount(root.parentElement); } }, "show log"));
    paintDetail();
  },
  hints: () => [["j/k", "move"], ["Enter", "accept suggestion"], ["t", "todo"], ["r", "reminder"], ["n", "note"], ["x", "keep"], ["e", "edit"], ["d", "delete"], ["h", "show log"]],
  onKey(e) {
    if (navKeys(lb, e)) { paintDetail(); return true; }
    const cur = lb.cur();
    if (e.key === "h") { showAll = !showAll; view.mount(root.parentElement); return true; }
    if (e.key === "Enter") return cur ? (suggestionOf(cur) ? acceptSuggestion(cur) : act("t", cur), true) : false;
    return act(e.key, cur);
  },
};
