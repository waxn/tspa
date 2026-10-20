// One keyboard dispatcher for the whole app.
//   overlay open  -> the topmost overlay gets every key (Esc closes it unless it handles Esc itself)
//   typing in a field -> hands off, except Esc blurs the field when nothing else claimed it
//   otherwise -> global keys (Space, /, 1-5, ?, u), then the current view's onKey
const overlays = [];
export const pushOverlay = (o) => overlays.push(o);
export const popOverlay = (o) => { const i = overlays.indexOf(o); if (i >= 0) overlays.splice(i, 1); };
export const hasOverlay = () => overlays.length > 0;

export const isTyping = (t) => !!t && (t.matches?.("input,textarea,select,[contenteditable='true']") ?? false);

export function initKeys({ globals, view }) {
  window.addEventListener("keydown", (e) => {
    if (e.isComposing || e.defaultPrevented && !overlays.length) return;
    const top = overlays[overlays.length - 1];
    if (top) {
      if (top.onKey?.(e)) e.preventDefault();
      else if (e.key === "Escape") { e.preventDefault(); top.close(); }
      return;
    }
    if (isTyping(e.target)) {
      if (e.key === "Escape" && !e.defaultPrevented) e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const handled = globals(e) || view()?.onKey?.(e);
    if (handled) e.preventDefault();
  });
}
