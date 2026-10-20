// Tasks: everything with a date or a checkbox, grouped by urgency.
import { deleteItem, editItem, itemForm, toggleItem } from "../actions.js";
import { agenda, S } from "../store.js";
import { listbox, navKeys } from "../ui.js";
import { fill, h } from "../util.js";
import { agendaRow } from "./common.js";

let root, lb, head, showDone = false, project = "";

const projects = () => [...new Set(S.projects.filter((p) => S.tasks.some((t) => t.project_id === p.id)).map((p) => p.name))];

export const view = {
  title: "tasks",
  mount(el) {
    head = h("div", { class: "vhead" });
    const list = h("div", { class: "list" });
    root = h("main", { class: "page narrow" }, head, h("section", { class: "panel focus" }, h("h2", { class: "ptitle" }, "tasks"), list));
    el.replaceChildren(root);
    lb = listbox({ el: list, items: () => agenda({ showDone, project }), row: agendaRow, section: (it) => it.section, onActivate: editItem, empty: project ? "nothing in this project." : "all clear. Space to capture something." });
    view.render();
  },
  unmount() {},
  render() {
    if (!lb) return;
    lb.render();
    const items = agenda({ project });
    fill(head,
      h("span", {}, `${items.filter((x) => x.section === "overdue").length} overdue · ${items.length} open`),
      project ? h("button", { class: "chip on", onclick: () => { project = ""; view.render(); } }, "#" + project + " ✕") : null,
      h("button", { class: "chip" + (showDone ? " on" : ""), onclick: () => { showDone = !showDone; view.render(); } }, "show done"));
  },
  hints: () => [["j/k", "move"], ["x", "done"], ["e", "edit"], ["d", "delete"], ["n", "new task"], ["r", "new reminder"], ["f", "filter project"], ["h", "show done"]],
  onKey(e) {
    if (navKeys(lb, e)) return true;
    const cur = lb.cur(), k = e.key;
    if (k === "Enter" || k === "e") return cur ? (editItem(cur), true) : false;
    if (k === "x" && cur) return toggleItem(cur), true;
    if (k === "d" && cur) return deleteItem(cur), true;
    if (k === "n") return itemForm(null, "task"), true;
    if (k === "r") return itemForm(null, "rem"), true;
    if (k === "h") { showDone = !showDone; view.render(); return true; }
    if (k === "f") {
      const all = ["", ...projects()];
      project = all[(all.indexOf(project) + 1) % all.length];
      view.render();
      return true;
    }
    return false;
  },
};
