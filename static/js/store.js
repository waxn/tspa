// One in-memory copy of everything (single user, small data), refreshed whenever the server says something changed.
import { api } from "./api.js";
import { dayDiff } from "./util.js";

export const S = { tasks: [], notes: [], stream: [], projects: [], reminders: [], widgets: [], wstate: {}, cfg: {} };

const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export async function load() {
  const [tasks, notes, stream, projects, reminders, widgets, wstate] = await Promise.all([
    api.get("/api/tasks"), api.get("/api/notes"), api.get("/api/stream"), api.get("/api/projects"),
    api.get("/api/reminders"), api.get("/api/widgets"), api.get("/api/widgets/state"),
  ]);
  Object.assign(S, { tasks, notes, stream, projects, reminders, widgets, wstate });
  emit();
}

export async function loadWidgetState() {
  S.wstate = await api.get("/api/widgets/state");
  emit();
}

let timer = null;
export function reloadSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => load().catch(() => {}), 150);
}

/** Run a mutation, then refresh. The SSE "changed" event repeats this on other devices. */
export async function mut(fn) {
  const out = await fn();
  await load();
  return out;
}

export const projectName = (id) => S.projects.find((p) => p.id === id)?.name || "";

export async function projectIdFor(name) {
  name = (name || "").trim().replace(/^#/, "");
  if (!name) return null;
  const hit = S.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.id : (await api.post("/api/projects", { name })).id;
}

// ---- derived views of the data -------------------------------------------------------------

/** Open tasks + unfired reminders in the order you should think about them, tagged with a section. */
export function agenda({ showDone = false, project = "" } = {}) {
  const now = Date.now(), out = [];
  const sec = (iso) => {
    const t = Date.parse(iso), d = dayDiff(iso);
    if (t < now && d < 0) return "overdue";
    if (d <= 0) return "today";
    if (d <= 7) return "this week";
    return "later";
  };
  for (const t of S.tasks) {
    if (project && projectName(t.project_id).toLowerCase() !== project.toLowerCase()) continue;
    if (t.done_at) { if (showDone) out.push({ type: "task", obj: t, at: t.due_at, section: "done" }); continue; }
    out.push({ type: "task", obj: t, at: t.due_at, section: t.due_at ? sec(t.due_at) : "no date" });
  }
  if (!project) for (const r of S.reminders) if (!r.fired_at) out.push({ type: "rem", obj: r, at: r.fire_at, section: sec(r.fire_at) });
  const rank = { overdue: 0, today: 1, "this week": 2, later: 3, "no date": 4, done: 5 };
  return out.sort((a, b) =>
    rank[a.section] - rank[b.section] ||
    (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity) ||
    (b.obj.priority || 0) - (a.obj.priority || 0));
}

export const inbox = () => S.stream.filter((e) => !e.triaged);
export const notesSorted = () => [...S.notes].sort((a, b) => (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at));
export const overdueCount = () => agenda().filter((x) => x.section === "overdue").length;

// ---- undo ----------------------------------------------------------------------------------

const undos = [];
/** Remember how to reverse the last action; `u` (outside text fields) runs it. */
export function pushUndo(label, fn) { undos.push({ label, fn }); if (undos.length > 10) undos.shift(); }
export async function popUndo() {
  const u = undos.pop();
  if (!u) return null;
  await u.fn();
  await load();
  return u.label;
}
