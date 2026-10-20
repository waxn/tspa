import { modal } from "./ui.js";
import { h } from "./util.js";

const SECTIONS = [
  ["everywhere", [["Space", "capture a thought / task / reminder"], ["/", "search & jump (type # for headings, > for commands)"], ["1 2 3 4 5", "home · notes · tasks · inbox · services"], ["u", "undo the last thing"], ["Esc", "close / leave a text box / go home"], ["?", "this help"]]],
  ["lists & panels", [["↑ ↓  or  j k", "move"], ["← →  or  h l", "switch panel (home)"], ["Tab", "next panel"], ["Enter", "open / accept"], ["x", "done / dismiss / keep"], ["e", "edit"], ["d", "delete (undo with u)"], ["n", "new"], ["g  G", "first / last"]]],
  ["capture bar", [["Enter", "save"], ["Tab", "force a type: todo, assignment, reminder, note, thought, project"], ["Alt+Enter", "save and add another"], ["Esc", "close — your text is kept"]]],
  ["writing a note", [["# ## ###", "headings (type then Space)"], ["- * 1. [] >", "bullet · bullet · numbered · to-do · quote"], ["``` ---", "code block · divider"], ["/", "block menu at the start of a line"], ["Enter  Shift+Enter", "new block · new line inside a block"], ["Tab  Shift+Tab", "indent / outdent a list item"], ["Ctrl+B  Ctrl+I  Ctrl+E", "bold · italic · code"], ["Alt+↑ ↓", "move block"], ["Ctrl+Enter", "tick a to-do"], ["Ctrl+Z  Ctrl+Shift+Z", "undo / redo"], ["Esc", "back to the note list"]]],
  ["quick-add examples", [["buy milk tomorrow", "todo due tomorrow"], ["bio lab due fri 5pm #bio !!", "assignment, project bio, high priority"], ["call mom in 30m", "reminder"], ["dentist tomorrow 8am", "reminder"], ["n: idea for a flight tracker", "note"], ["anything else", "a thought in your inbox"]]],
];

export function openHelp() {
  return modal(h("div", { class: "help" }, h("div", { class: "mtitle" }, "keyboard"),
    h("div", { class: "help-grid" }, SECTIONS.map(([t, rows]) => h("section", {}, h("h3", {}, t),
      rows.map(([k, d]) => h("div", { class: "hrow" }, h("span", { class: "keys" }, ...k.split("  ").map((x) => h("kbd", {}, x))), h("span", { class: "dim" }, d)))))),
    h("div", { class: "fkeys" }, "Esc to close")), { wide: true });
}
