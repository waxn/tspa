import { S, load, emit } from "./store.js";
import { PANELS, ui, act, render, setFocus, move, moveTo, cycle, setHintHandler } from "./panels.js";
import { openModal, isModalOpen } from "./modal.js";
import { openQuickAdd } from "./quickadd.js";
import { h } from "./util.js";

const HELP = [
  ["Global", [["a / Space", "quick add (type naturally)"], ["1 – 6", "focus panel"], ["Tab / Shift+Tab", "next / previous panel"],
    ["/", "filter everything"], ["h", "show / hide completed"], ["z", "zoom focused panel"], ["r", "reload"], ["i", "write to stream"], ["?", "this help"], ["Esc", "back out / clear filter"]]],
  ["In a panel", [["j / ↓   k / ↑", "move"], ["g / G", "top / bottom"], ["Enter / e", "open / edit"], ["x", "done · pin · dismiss"], ["n", "new item"], ["d", "delete (asks y/n)"]]],
  ["Quick add", [["Bio project due 10/24", "→ due-date task"], ["va state test 2hr", "→ silent reminder in 2h"], ["call mom at 3pm", "→ reminder today 3pm"], ["buy milk tomorrow", "→ todo due tomorrow"],
    ["n: …   i: …   > …", "note · stream entry · stream"], ["p: name", "new project"], ["#bio   !!", "project tag · priority"], ["Tab (in bar)", "force type"]]],
];

function showHelp() {
  const col = ([title, rows]) => h("div", {}, h("div", { class: "dim", style: "margin:.4rem 0 .2rem" }, title),
    h("table", { class: "keys" }, rows.map(([k, d]) => h("tr", {}, h("td", {}, k), h("td", {}, d)))));
  openModal("help", h("div", { class: "help-cols" }, HELP.map(col)));
}

function showFilter() {
  const input = h("input", { class: "qa-input", value: S.filter, placeholder: "filter todos, notes, projects… (empty clears)", autocomplete: "off" });
  openModal("filter", h("div", {}, input, h("div", { class: "mhint" }, h("span", {}, h("b", {}, "Enter"), " apply"), h("span", {}, h("b", {}, "Esc"), " cancel"))), {
    onKey: (e, close) => { if (e.key === "Enter") { S.filter = input.value; close(); render(); } },
  });
}

export function press(key, shift = false) {
  switch (key) {
    case "a": case " ": openQuickAdd(); return true;
    case "1": case "2": case "3": case "4": case "5": case "6": setFocus(PANELS[+key - 1].id); return true;
    case "Tab": cycle(shift ? -1 : 1); return true;
    case "1-6": cycle(1); return true;
    case "j": case "ArrowDown": move(1); return true;
    case "k": case "ArrowUp": move(-1); return true;
    case "g": case "Home": moveTo(0); return true;
    case "G": case "End": moveTo(Infinity); return true;
    case "Enter": case "e": act.edit(); return true;
    case "x": act.toggle(); return true;
    case "n": act.create(); return true;
    case "d": act.del(); return true;
    case "/": showFilter(); return true;
    case "h": S.showDone = !S.showDone; render(); return true;
    case "z": ui.zoom = !ui.zoom; render(); return true;
    case "r": load(); return true;
    case "i": setFocus("stream"); document.getElementById("sinput").focus(); return true;
    case "?": showHelp(); return true;
    case "Escape":
      if (S.filter) { S.filter = ""; render(); } else if (ui.zoom) { ui.zoom = false; render(); }
      return true;
  }
  return false;
}

export function wireKeys() {
  setHintHandler((k) => press(k));
  document.addEventListener("keydown", (e) => {
    if (isModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.target.closest?.("button") && (e.key === "Enter" || e.key === " ")) return; // let buttons activate natively
    if (press(e.key, e.shiftKey)) e.preventDefault();
  });
}
