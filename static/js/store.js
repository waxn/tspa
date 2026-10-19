import { api } from "./api.js";

export const S = { tasks: [], projects: [], notes: [], stream: [], reminders: [], config: {}, showDone: false, filter: "" };
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((f) => f());

export async function load() {
  const names = ["tasks", "projects", "notes", "stream", "reminders"];
  const res = await Promise.all(names.map((n) => api.get("/api/" + n)));
  names.forEach((n, i) => { S[n] = res[i]; });
  emit();
}
let timer;
export function reloadSoon() { clearTimeout(timer); timer = setTimeout(() => load().catch(() => {}), 150); }
export const projectName = (id) => S.projects.find((p) => p.id === id)?.name;
