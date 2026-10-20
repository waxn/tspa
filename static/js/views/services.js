// Services: tiles for the things you self-host. The server polls them (so API keys never reach the browser).
import { widgetForm } from "../actions.js";
import { api } from "../api.js";
import { confirmBox } from "../ui.js";
import { mut, S } from "../store.js";
import { h, toast } from "../util.js";
import { neighbor, widgetCard } from "./common.js";

let root, grid, sel = 0, lastId = null;

const cards = () => [...grid.querySelectorAll(".card")];

function paint(scroll) {
  cards().forEach((c, n) => c.classList.toggle("sel", n === sel));
  if (scroll) cards()[sel]?.scrollIntoView({ block: "nearest" });
}

export const view = {
  title: "services",
  mount(el) {
    grid = h("div", { class: "cards" });
    root = h("main", { class: "page" },
      h("div", { class: "vhead" }, h("span", { class: "dim" }, "checked every 30 s by the server"),
        h("button", { class: "chip", onclick: () => view.refresh() }, "refresh"),
        h("button", { class: "chip on", onclick: () => widgetForm() }, "+ add service")),
      grid);
    el.replaceChildren(root);
    view.render();
  },
  unmount() {},
  render() {
    if (!grid) return;
    const idx = S.widgets.findIndex((w) => w.id === lastId);
    if (idx >= 0) sel = idx;
    sel = Math.max(0, Math.min(sel, S.widgets.length - 1));
    if (!S.widgets.length) {
      grid.replaceChildren(h("div", { class: "empty big" }, "Nothing here yet. Press ", h("kbd", {}, "n"), " to add a service —",
        h("br"), "a website's up/down, or numbers from any JSON API (Immich, Pi-hole, your own scripts…)."));
      return;
    }
    grid.replaceChildren(...S.widgets.map((w, n) => {
      const c = widgetCard(w, S.wstate[w.id]);
      c.dataset.n = n;
      c.addEventListener("click", () => { sel = n; lastId = w.id; paint(); });
      c.addEventListener("dblclick", () => widgetForm(w));
      return c;
    }));
    paint();
  },
  async refresh() {
    await api.post("/api/widgets/refresh");
    toast("refreshed");
  },
  hints: () => [["←↑↓→", "move"], ["Enter", "edit"], ["n", "add"], ["d", "remove"], ["r", "refresh"]],
  onKey(e) {
    const k = e.key, w = S.widgets[sel];
    const dir = { ArrowLeft: "left", h: "left", ArrowRight: "right", l: "right", ArrowUp: "up", k: "up", ArrowDown: "down", j: "down" }[k];
    if (dir) {
      const j = neighbor(cards(), sel, dir);
      if (j >= 0) { sel = j; lastId = S.widgets[j].id; paint(true); }
      return true;
    }
    if (k === "n") return widgetForm(), true;
    if (k === "r") return view.refresh(), true;
    if ((k === "Enter" || k === "e") && w) return widgetForm(w), true;
    if (k === "d" && w) {
      confirmBox(`Remove "${w.name}" from the dashboard?`, "remove").then((ok) => ok && mut(() => api.del(`/api/widgets/${w.id}`)));
      return true;
    }
    return false;
  },
};
