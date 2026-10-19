import { api } from "./api.js";
import { S, load } from "./store.js";
import { openModal, confirmBox } from "./modal.js";
import { h, toast, toLocalInput, fromLocalInput } from "./util.js";

const FORMS = {
  task: {
    path: "/api/tasks",
    fields: () => [
      { k: "title", label: "title", type: "text", req: true },
      { k: "kind", label: "type", type: "select", opts: [["todo", "todo"], ["assignment", "assignment / paper"]] },
      { k: "due_at", label: "due", type: "datetime" },
      { k: "priority", label: "priority", type: "select", num: true, opts: [[0, "none"], [1, "! low"], [2, "!! medium"], [3, "!!! high"]] },
      { k: "project_id", label: "project", type: "select", num: true, nullable: true, opts: [["", "—"], ...S.projects.map((p) => [p.id, p.name])] },
      { k: "notes", label: "notes", type: "textarea", rows: 4 },
    ],
  },
  note: {
    path: "/api/notes",
    fields: () => [
      { k: "title", label: "title", type: "text", req: true },
      { k: "body", label: "body (markdown ok)", type: "textarea", rows: 16 },
      { k: "project_id", label: "project", type: "select", num: true, nullable: true, opts: [["", "—"], ...S.projects.map((p) => [p.id, p.name])] },
    ],
  },
  project: {
    path: "/api/projects",
    fields: () => [
      { k: "name", label: "name", type: "text", req: true },
      { k: "status", label: "status", type: "select", opts: [["active", "active"], ["paused", "paused"], ["done", "done"]] },
      { k: "description", label: "description", type: "textarea", rows: 5 },
    ],
  },
  reminder: {
    path: "/api/reminders",
    fields: () => [
      { k: "text", label: "text", type: "text", req: true },
      { k: "fire_at", label: "when", type: "datetime", req: true },
    ],
  },
  stream: {
    path: "/api/stream",
    fields: () => [{ k: "body", label: "entry", type: "textarea", rows: 6, req: true }],
  },
};

/** Open an add/edit form for `type`. `item` null = create (with `defaults`). */
export function openForm(type, item = null, defaults = {}) {
  const spec = FORMS[type], fields = spec.fields(), vals = { ...defaults, ...(item || {}) };
  const inputs = {};
  const rows = fields.map((f) => {
    let el;
    if (f.type === "textarea") el = h("textarea", { rows: f.rows || 4 });
    else if (f.type === "select") {
      el = h("select", {}, f.opts.map(([v, l]) => h("option", { value: v }, l)));
    } else el = h("input", { type: f.type === "datetime" ? "datetime-local" : "text", autocomplete: "off" });
    const v = vals[f.k];
    el.value = f.type === "datetime" ? toLocalInput(v) : v ?? (f.type === "select" ? f.opts[0][0] : "");
    inputs[f.k] = el;
    return h("label", { class: "field" }, h("span", {}, f.label + (f.req ? " *" : "")), el);
  });

  async function save() {
    const data = {};
    for (const f of fields) {
      const raw = inputs[f.k].value;
      if (f.req && !raw.trim()) { inputs[f.k].focus(); toast(`${f.label} is required`, "warn"); return; }
      data[f.k] = f.type === "datetime" ? fromLocalInput(raw) : f.num ? (raw === "" ? null : Number(raw)) : raw;
    }
    try {
      if (item) await api.patch(`${spec.path}/${item.id}`, data);
      else await api.post(spec.path, data);
      m.close();
      await load();
    } catch (e) { toast(e.message, "err"); }
  }
  async function remove() {
    if (!(await confirmBox("Delete this " + type + "?"))) return;
    await api.del(`${spec.path}/${item.id}`);
    m.close();
    await load();
  }

  const body = h("form", { onsubmit: (e) => { e.preventDefault(); save(); } }, rows,
    h("div", { class: "btns" },
      item && h("button", { type: "button", class: "btn danger", onclick: remove }, "delete"),
      h("button", { type: "button", class: "btn", onclick: () => m.close() }, "cancel [esc]"),
      h("button", { type: "submit", class: "btn primary" }, "save [ctrl+enter]")));
  const m = openModal((item ? "edit " : "new ") + type, body, {
    onKey: (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } },
  });
  return m;
}
