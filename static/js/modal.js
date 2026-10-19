import { h } from "./util.js";

let open = null;
export const isModalOpen = () => !!open;

/** Show a modal. `onKey` gets keydown events from inside it. Returns { close, el }. */
export function openModal(title, content, { onKey, onClose, focus } = {}) {
  closeModal();
  const box = h("div", { class: "modal", tabindex: "-1", role: "dialog", "aria-label": title }, h("h2", { class: "ptitle" }, title), content);
  const bg = h("div", { class: "modal-bg", onmousedown: (e) => { if (e.target === bg) close(); } }, box);
  const close = () => { if (open?.bg !== bg) return; bg.remove(); open = null; onClose?.(); };
  box.addEventListener("keydown", (e) => {
    e.stopPropagation(); // a key that closes the modal must not fall through to the global shortcuts
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    onKey?.(e, close);
  });
  document.body.append(bg);
  open = { bg, close };
  (box.querySelector(focus || "input, textarea, select") || box).focus();
  return { close, el: box };
}
export function closeModal() { open?.close(); }

export function confirmBox(message) {
  return new Promise((resolve) => {
    let answer = false;
    const yes = () => { answer = true; m.close(); }, no = () => m.close();
    const body = h("div", {}, h("p", {}, message), h("div", { class: "btns" },
      h("button", { class: "btn danger", onclick: yes }, "[y] yes"), h("button", { class: "btn", onclick: no }, "[n] no")));
    const m = openModal("confirm", body, {
      onKey: (e) => { const k = e.key.toLowerCase(); if (k === "y" || k === "enter") yes(); else if (k === "n") no(); },
      onClose: () => resolve(answer),
    });
    m.el.focus();
  });
}
