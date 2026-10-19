async function call(method, path, body) {
  const r = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.href = "/login"; throw new Error("not logged in"); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (_) {}
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}
export const api = {
  get: (p) => call("GET", p),
  post: (p, b) => call("POST", p, b ?? {}),
  patch: (p, b) => call("PATCH", p, b),
  del: (p) => call("DELETE", p),
};
