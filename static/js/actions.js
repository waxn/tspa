// Things you can do to items, shared by several views (home panels, task list, inbox, palette).
import { api } from "./api.js";
import { nav } from "./nav.js";
import { S, mut, projectIdFor, projectName, pushUndo } from "./store.js";
import { confirmBox, formModal } from "./ui.js";
import { fill, h, toast } from "./util.js";

const taskBody = (t) => ({ title: t.title, notes: t.notes, kind: t.kind, due_at: t.due_at, priority: t.priority, done_at: t.done_at, project_id: t.project_id });

export async function toggleItem(it) {
  if (it.type === "rem") {
    const r = it.obj;
    await mut(() => api.del(`/api/reminders/${r.id}`));
    pushUndo("reminder dismissed", () => api.post("/api/reminders", { text: r.text, fire_at: r.fire_at }));
    toast("reminder dismissed · u to undo");
    return;
  }
  const t = it.obj, done = !t.done_at;
  await mut(() => api.patch(`/api/tasks/${t.id}`, { done_at: done ? new Date().toISOString() : null }));
  pushUndo(done ? "marked done" : "reopened", () => api.patch(`/api/tasks/${t.id}`, { done_at: t.done_at }));
  if (done) toast("done · u to undo");
}

export async function deleteItem(it) {
  const t = it.obj;
  if (it.type === "rem") await mut(() => api.del(`/api/reminders/${t.id}`));
  else await mut(() => api.del(`/api/tasks/${t.id}`));
  pushUndo("deleted", () => (it.type === "rem"
    ? api.post("/api/reminders", { text: t.text, fire_at: t.fire_at })
    : api.post("/api/tasks", taskBody(t))));
  toast("deleted · u to undo");
}

const PRIORITIES = [{ value: 0, label: "normal" }, { value: 1, label: "! medium" }, { value: 2, label: "!! high" }, { value: 3, label: "!!! urgent" }];

/** Create (it = null) or edit a task / reminder. */
export function itemForm(it, type = "task") {
  if ((it?.type || type) === "rem") {
    const r = it?.obj;
    return formModal({
      title: r ? "edit reminder" : "new reminder",
      fields: [
        { name: "text", label: "what", value: r?.text || "" },
        { name: "fire_at", label: "when", type: "when", kind: "reminder", value: r?.fire_at, hint: "e.g. in 2 hours, tomorrow 8am, fri 3pm" },
      ],
      danger: r ? { label: "delete", run: () => deleteItem(it) } : null,
      async onSubmit(v) {
        if (!v.text.trim()) throw new Error("say what to remind you of");
        if (!v.fire_at) throw new Error("a reminder needs a time");
        await mut(() => (r ? api.patch(`/api/reminders/${r.id}`, { text: v.text.trim(), fire_at: v.fire_at, fired_at: null })
          : api.post("/api/reminders", { text: v.text.trim(), fire_at: v.fire_at })));
      },
    });
  }
  const t = it?.obj;
  return formModal({
    title: t ? "edit task" : "new task",
    fields: [
      { name: "title", label: "title", value: t?.title || "" },
      { name: "due_at", label: "due", type: "when", kind: "todo", value: t?.due_at, hint: "e.g. friday 5pm, tomorrow, 10/24 — blank for none" },
      { name: "kind", label: "type", type: "select", value: t?.kind || "todo", options: [{ value: "todo", label: "todo" }, { value: "assignment", label: "assignment (school)" }] },
      { name: "priority", label: "priority", type: "select", value: t?.priority || 0, options: PRIORITIES },
      { name: "project", label: "project", value: t ? projectName(t.project_id) : "", hint: "optional, e.g. bio" },
      { name: "notes", label: "notes", type: "area", rows: 3, value: t?.notes || "" },
    ],
    danger: t ? { label: "delete", run: () => deleteItem(it) } : null,
    async onSubmit(v) {
      if (!v.title.trim()) throw new Error("title can't be empty");
      const body = { title: v.title.trim(), due_at: v.due_at, kind: v.kind, priority: +v.priority, notes: v.notes, project_id: await projectIdFor(v.project) };
      await mut(() => (t ? api.patch(`/api/tasks/${t.id}`, body) : api.post("/api/tasks", body)));
    },
  });
}

export const editItem = (it) => itemForm(it);

// ---- notes ----------------------------------------------------------------------------------

export async function newNote(initial = {}) {
  const n = await mut(() => api.post("/api/notes", { title: "", body: "", ...initial }));
  nav.go("notes", n.id);
  return n;
}

export async function deleteNote(n) {
  if (!(await confirmBox(`Delete note "${n.title || "Untitled"}"?`))) return false;
  await mut(() => api.del(`/api/notes/${n.id}`));
  pushUndo("note deleted", () => api.post("/api/notes", { title: n.title, body: n.body, pinned: n.pinned, project_id: n.project_id }));
  toast("note deleted · u to undo");
  return true;
}

// ---- inbox ---------------------------------------------------------------------------------

const firstLine = (s, n = 60) => { const l = s.split("\n")[0].trim(); return l.length > n ? l.slice(0, n - 1) + "…" : l; };
export const thoughtTitle = (e) => e.summary || firstLine(e.body, 90);
export const suggestionOf = (e) => { try { return e.suggest ? JSON.parse(e.suggest) : null; } catch (_) { return null; } };

async function convert(entry, item) {
  const out = await mut(() => api.post(`/api/stream/${entry.id}/convert`, item));
  pushUndo("sorted", async () => {
    const route = { todo: "tasks", assignment: "tasks", reminder: "reminders", note: "notes", project: "projects" }[out.kind];
    await api.del(`/api/${route}/${out.item.id}`);
    await api.post("/api/stream", { body: entry.body, summary: entry.summary, tags: entry.tags, suggest: entry.suggest, created_at: entry.created_at });
  });
  toast(`→ ${out.kind}: ${out.item.title || out.item.text || out.item.name} · u to undo`);
  return out;
}

/** Take the AI's suggestion as-is (Enter on a suggested thought). */
export async function acceptSuggestion(entry) {
  const s = suggestionOf(entry);
  if (!s) return false;
  const out = await convert(entry, { kind: s.kind, title: s.title, due_at: s.due_at, fire_at: s.fire_at, project: s.project, priority: s.priority });
  if (s.kind === "note") nav.go("notes", out.item.id);
  return true;
}

/** Sort a thought into `kind`; asks only for what's still missing. */
export async function triage(entry, kind) {
  if (kind === "note") {
    const out = await convert(entry, { kind: "note", title: thoughtTitle(entry).slice(0, 80) || "Untitled" });
    nav.go("notes", out.item.id);
    return;
  }
  const sug = suggestionOf(entry);
  const guess = sug && (sug.kind === kind || (kind === "todo" && sug.kind === "assignment")) ? sug
    : await api.post("/api/capture/preview", { text: entry.body, kind });
  const rem = kind === "reminder";
  formModal({
    title: `${kind} from thought`,
    fields: [
      { name: "title", label: rem ? "what" : "title", value: guess.title || thoughtTitle(entry) },
      { name: "when", label: rem ? "when" : "due", type: "when", kind: rem ? "reminder" : "todo", value: rem ? guess.fire_at : guess.due_at, hint: rem ? "required" : "optional" },
      rem ? null : { name: "project", label: "project", value: guess.project || "" },
    ].filter(Boolean),
    submit: "sort it",
    async onSubmit(v) {
      if (!v.title.trim()) throw new Error("title can't be empty");
      if (rem && !v.when) throw new Error("a reminder needs a time");
      await convert(entry, { kind: rem ? "reminder" : (kind === "assignment" ? "assignment" : "todo"), title: v.title.trim(), due_at: rem ? null : v.when, fire_at: rem ? v.when : null, project: v.project || null, priority: guess.priority || 0 });
    },
  });
}

export async function keepThought(entry) {
  await mut(() => api.patch(`/api/stream/${entry.id}`, { triaged: true }));
  pushUndo("kept in log", () => api.patch(`/api/stream/${entry.id}`, { triaged: false }));
  toast("kept in your log · u to undo");
}

export async function deleteThought(entry) {
  await mut(() => api.del(`/api/stream/${entry.id}`));
  pushUndo("thought deleted", () => api.post("/api/stream", { body: entry.body, summary: entry.summary, tags: entry.tags, suggest: entry.suggest, triaged: entry.triaged, created_at: entry.created_at }));
  toast("deleted · u to undo");
}

// ---- service widgets -------------------------------------------------------------------------

const hdrToText = (raw) => { try { return Object.entries(JSON.parse(raw || "{}")).map(([k, v]) => `${k}: ${v}`).join("\n"); } catch (_) { return ""; } };
const textToHdr = (t) => JSON.stringify(Object.fromEntries(t.split("\n").map((l) => l.split(/:(.*)/s)).filter((p) => p[0]?.trim() && p[1] !== undefined).map((p) => [p[0].trim(), p[1].trim()])));
const fieldsToText = (raw) => { try { return JSON.parse(raw || "[]").map((f) => [f.label, f.path, f.fmt || "num"].join(" | ")).join("\n"); } catch (_) { return ""; } };
const textToFields = (t) => t.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[1]).map((p) => ({ label: p[0] || p[1], path: p[1], fmt: p[2] || "num" }));

const PRESETS = {
  custom: null,
  site: { name: "My site", kind: "status", url: "http://192.168.1.10:8080/", headers: "", fields: "" },
  immich: { name: "Immich", kind: "stat", url: "http://IMMICH-HOST:2283/api/server/statistics", headers: "x-api-key: PASTE_API_KEY", fields: "Photos | photos | num\nVideos | videos | num\nStorage | usage | bytes" },
};

export function widgetForm(w = null) {
  const probeOut = h("div", { class: "probe" });
  const probeBtn = h("button", { type: "button", class: "btn" }, "test it & list the values it returns");
  const o = formModal({
    title: w ? `edit ${w.name}` : "add a service",
    fields: [
      w ? null : { name: "preset", label: "start from", type: "select", value: "custom", options: [{ value: "custom", label: "blank" }, { value: "site", label: "website / service up-down" }, { value: "immich", label: "Immich photo stats" }] },
      { name: "name", label: "name", value: w?.name || "" },
      { name: "kind", label: "shows", type: "select", value: w?.kind || "status", options: [{ value: "status", label: "up / down + response time" }, { value: "stat", label: "numbers from a JSON API" }] },
      { name: "url", label: "url", value: w?.url || "", placeholder: "http://192.168.1.10:8080/", hint: "tspa's server makes this request, so it must be able to reach it" },
      { name: "headers", label: "headers", type: "area", rows: 2, value: w ? hdrToText(w.headers) : "", placeholder: "x-api-key: …   (one per line)" },
      { name: "fields", label: "values", type: "area", rows: 3, value: w ? fieldsToText(w.fields) : "", placeholder: "Photos | photos | num      (label | json.path | num/bytes/pct/dur)", hint: "only for “numbers” tiles" },
    ].filter(Boolean),
    submit: w ? "save" : "add",
    extra: h("div", {}, probeBtn, probeOut),
    danger: w ? { label: "delete", run: async () => { await mut(() => api.del(`/api/widgets/${w.id}`)); toast("service removed"); } } : null,
    async onSubmit(v) {
      if (!v.name.trim() || !v.url.trim()) throw new Error("name and url are required");
      const body = { name: v.name.trim(), kind: v.kind, url: v.url.trim(), headers: textToHdr(v.headers), fields: JSON.stringify(textToFields(v.fields)) };
      if (!w) body.pos = (S.widgets.reduce((m, x) => Math.max(m, x.pos), 0)) + 1;
      await mut(() => (w ? api.patch(`/api/widgets/${w.id}`, body) : api.post("/api/widgets", body)));
    },
  });
  o.inputs.preset?.addEventListener("change", () => {
    const p = PRESETS[o.inputs.preset.value];
    if (p) for (const k of Object.keys(p)) o.inputs[k].value = p[k];
  });
  probeBtn.addEventListener("click", async () => {
    fill(probeOut, h("span", { class: "dim" }, "asking…"));
    try {
      const r = await api.post("/api/widgets/probe", { url: o.inputs.url.value.trim(), headers: textToHdr(o.inputs.headers.value) });
      if (!r.json) return fill(probeOut, h("span", { class: r.status < 400 ? "ok" : "bad" }, `HTTP ${r.status} in ${r.ms}ms — reachable, but not JSON (fine for up/down tiles)`));
      fill(probeOut, 
        h("div", { class: r.status < 400 ? "ok" : "bad" }, `HTTP ${r.status} in ${r.ms}ms — click a value to add it as a tile number`),
        ...r.fields.filter((f) => typeof f.value !== "object").map((f) => h("button", {
          type: "button", class: "probe-item", onclick: () => {
            const ta = o.inputs.fields, label = f.path.split(".").pop();
            ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + `${label} | ${f.path} | ${typeof f.value === "number" ? "num" : "raw"}`;
            o.inputs.kind.value = "stat";
          },
        }, h("code", {}, f.path), " ", h("span", { class: "dim" }, String(f.value).slice(0, 40)))));
    } catch (e) { fill(probeOut, h("span", { class: "bad" }, e.message)); }
  });
  return o;
}
