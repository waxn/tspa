import { api } from "./api.js";
import { S, load, onChange } from "./store.js";
import { render, wireMouse, PANELS } from "./panels.js";
import { wireKeys } from "./keys.js";
import { setTZ, fmtDate, fmtTime, toast } from "./util.js";
import * as notify from "./notify.js";

async function boot() {
  S.config = await api.get("/api/config");
  setTZ(S.config.tz);
  onChange(render);
  wireMouse();
  wireKeys();

  // stream input: Enter saves an entry
  document.getElementById("sform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("sinput"), body = input.value.trim();
    if (!body) return;
    try { await api.post("/api/stream", { body }); input.value = ""; await load(); } catch (err) { toast(err.message, "err"); }
  });

  const clock = document.getElementById("clock");
  const tick = () => { const n = new Date().toISOString(); clock.textContent = `${fmtDate(n)}  ${fmtTime(n)}`; };
  tick();
  setInterval(tick, 10000);
  setInterval(render, 20000); // keep countdowns / overdue fresh

  const nb = document.getElementById("notifybtn");
  const paint = () => {
    const s = notify.status();
    nb.textContent = "notify: " + s;
    nb.className = "chip" + (s === "on" ? " on" : s === "blocked" ? " bad" : "");
  };
  nb.addEventListener("click", async () => { if (notify.status() === "on") await notify.disable(); else await notify.enable(); paint(); });
  document.getElementById("logoutbtn").addEventListener("click", async () => { await fetch("/logout", { method: "POST" }); location.href = "/login"; });
  document.getElementById("filterchip").addEventListener("click", () => { S.filter = ""; render(); });

  await load();
  await notify.init(S.config, paint);
  paint();
  document.body.dataset.ready = "1"; // used by the e2e test
}
boot().catch((e) => console.error(e));
