async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (r.status === 401) { location.href = "/login"; throw new Error("not logged in"); }
  if (!r.ok) {
    let msg = "";
    try { const d = await r.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail); } catch (_) {}
    throw new Error(msg || `request failed (${r.status})`);
  }
  return r.status === 204 ? null : r.json();
}

export const api = {
  get: (u) => req("GET", u),
  post: (u, b = {}) => req("POST", u, b),
  patch: (u, b) => req("PATCH", u, b),
  del: (u) => req("DELETE", u),
};
