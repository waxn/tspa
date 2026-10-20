// Block editor with Notion-style shortcuts. Notes are stored as plain Markdown.
//
// Each block is a type + text. The block you're in is a plain <textarea> showing raw Markdown (so caret, IME, selection and
// spellcheck all behave); every other block is shown rendered. Typing "## " at the start of a paragraph turns it into
// a heading, "- " a bullet, "[] " a checkbox, "> " a quote, "```" code, "---" a divider; "/" opens a block menu.
import { h } from "./util.js";

// ---- markdown <-> blocks ---------------------------------------------------------------------

const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_FENCE = /^```\s*([\w+-]*)\s*$/;
const RE_H = /^(#{1,3}) +(.*)$/;
const RE_TODO = /^( *)[-*+] \[( |x|X)\] ?(.*)$/;
const RE_UL = /^( *)[-*+] (.*)$/;
const RE_OL = /^( *)\d+[.)] (.*)$/;
const RE_Q = /^ {0,3}> ?(.*)$/;

const isListType = (t) => t === "ul" || t === "ol" || t === "todo";
const blockStart = (l) => RE_FENCE.test(l) || RE_HR.test(l) || RE_H.test(l) || RE_TODO.test(l) || RE_UL.test(l) || RE_OL.test(l) || RE_Q.test(l);

export function parseMd(md) {
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    let m;
    if (!l.trim()) continue;
    if ((m = l.match(RE_FENCE))) {
      const body = [];
      n++;
      while (n < lines.length && !/^```\s*$/.test(lines[n])) body.push(lines[n++]);
      out.push({ t: "code", text: body.join("\n"), lang: m[1] || "" });
    } else if (RE_HR.test(l)) out.push({ t: "hr", text: "" });
    else if ((m = l.match(RE_H))) out.push({ t: "h" + m[1].length, text: m[2] });
    else if ((m = l.match(RE_TODO))) out.push({ t: "todo", text: m[3], checked: m[2] !== " ", indent: Math.min(4, m[1].length >> 1) });
    else if ((m = l.match(RE_UL))) out.push({ t: "ul", text: m[2], indent: Math.min(4, m[1].length >> 1) });
    else if ((m = l.match(RE_OL))) out.push({ t: "ol", text: m[2], indent: Math.min(4, m[1].length >> 1) });
    else if ((m = l.match(RE_Q))) {
      const q = [m[1]];
      while (n + 1 < lines.length && RE_Q.test(lines[n + 1])) q.push(lines[++n].match(RE_Q)[1]);
      out.push({ t: "quote", text: q.join("\n") });
    } else {
      const p = [l.replace(/\s+$/, "")];
      while (n + 1 < lines.length && lines[n + 1].trim() && !blockStart(lines[n + 1])) p.push(lines[++n].replace(/\s+$/, ""));
      out.push({ t: "p", text: p.join("\n") });
    }
    // indented continuation lines belong to the list item above them
    const last = out[out.length - 1];
    if (isListType(last.t)) {
      while (n + 1 < lines.length && /^ {2,}\S/.test(lines[n + 1]) && !blockStart(lines[n + 1].trimStart())) last.text += "\n" + lines[++n].trim();
    }
  }
  return out.length ? out : [{ t: "p", text: "" }];
}

export function toMd(blocks) {
  const parts = [];
  let num = [], prevList = false;
  blocks.forEach((b) => {
    let s;
    const pad = "  ".repeat(b.indent || 0);
    if (b.t !== "ol") num = [];
    switch (b.t) {
      case "h1": s = "# " + b.text; break;
      case "h2": s = "## " + b.text; break;
      case "h3": s = "### " + b.text; break;
      case "ul": s = pad + "- " + b.text.replace(/\n/g, "\n" + pad + "  "); break;
      case "todo": s = pad + `- [${b.checked ? "x" : " "}] ` + b.text.replace(/\n/g, "\n" + pad + "  "); break;
      case "ol": {
        const d = b.indent || 0;
        num.length = d + 1;
        for (let k = 0; k < d; k++) num[k] ||= 1;
        num[d] = (num[d] || 0) + 1;
        s = pad + `${num[d]}. ` + b.text.replace(/\n/g, "\n" + pad + "   ");
        break;
      }
      case "quote": s = b.text.split("\n").map((x) => "> " + x).join("\n"); break;
      case "code": s = "```" + (b.lang || "") + "\n" + b.text + "\n```"; break;
      case "hr": s = "---"; break;
      default: s = b.text;
    }
    const list = isListType(b.t);
    parts.push((parts.length ? (list && prevList ? "\n" : "\n\n") : "") + s);
    prevList = list;
  });
  return parts.join("").replace(/\s+$/, "") + "\n";
}

/** [{i, level, text}] for every heading in a Markdown string (i = block index, shared with the editor). */
export function headingsOf(md) {
  return parseMd(md).flatMap((b, i) => (/^h[123]$/.test(b.t) ? [{ i, level: +b.t[1], text: plain(b.text) }] : []));
}

export const plain = (s) => s.replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~]{1,2}/g, "").trim();

// ---- inline rendering (for blocks you're not editing) ------------------------------------------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

export function inline(src) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const url = u.replace(/&amp;/g, "&");
    return SAFE_URL.test(url) ? keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t}</a>`) : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) => `${pre}${keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)}`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, "$1<i>$2</i>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/(^|\s)#([\w-]+)/g, '$1<span class="tag">#$2</span>');
  return s.replace(/\n/g, "<br>").replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]);
}

// ---- the editor ----------------------------------------------------------------------------------

const MENU = [
  { t: "p", label: "Text", sub: "plain paragraph", keys: "text paragraph p" },
  { t: "h1", label: "Heading 1", sub: "#", keys: "heading 1 h1 title" },
  { t: "h2", label: "Heading 2", sub: "##", keys: "heading 2 h2" },
  { t: "h3", label: "Heading 3", sub: "###", keys: "heading 3 h3" },
  { t: "ul", label: "Bullet list", sub: "-", keys: "bullet list ul" },
  { t: "ol", label: "Numbered list", sub: "1.", keys: "numbered list ol" },
  { t: "todo", label: "To-do", sub: "[]", keys: "todo check task checkbox" },
  { t: "quote", label: "Quote", sub: ">", keys: "quote" },
  { t: "code", label: "Code", sub: "```", keys: "code" },
  { t: "hr", label: "Divider", sub: "---", keys: "divider line hr" },
];

const PLACEHOLDER = { p: "Type / for blocks, or just write", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", ul: "List", ol: "List", todo: "To-do", quote: "Quote", code: "Code" };

const SHORTCUTS = [
  [/^(#{1,3}) $/, (m) => ({ t: "h" + m[1].length })],
  [/^[-*+] $/, () => ({ t: "ul" })],
  [/^\d+[.)] $/, () => ({ t: "ol" })],
  [/^(?:- )?\[ ?\] $/, () => ({ t: "todo", checked: false })],
  [/^> $/, () => ({ t: "quote" })],
  [/^```$/, () => ({ t: "code", lang: "" })],
  [/^---$/, () => ({ t: "hr" })],
];

export function createEditor(root, { onChange = () => {}, onExit = () => {} } = {}) {
  let blocks = [];
  let hist = [], redo = [], typingTimer = null;
  let menu = null;
  let goal = null; // column to aim for while ArrowUp/Down pass through shorter lines
  const mirror = h("div", { class: "mirror", "aria-hidden": "true" });
  document.body.append(mirror);

  const snap = (focus) => JSON.stringify({ blocks, focus });
  function pushHist(focus = curIndex()) { hist.push(snap(focus)); if (hist.length > 200) hist.shift(); redo = []; }
  function restore(s) {
    const d = JSON.parse(s);
    blocks = d.blocks;
    build();
    focusBlock(Math.min(d.focus ?? 0, blocks.length - 1), "end");
    onChange();
  }
  function undo() {
    if (!hist.length) return;
    redo.push(snap(curIndex()));
    clearTimeout(typingTimer); typingTimer = null;
    restore(hist.pop());
  }
  function redoIt() {
    if (!redo.length) return;
    hist.push(snap(curIndex()));
    restore(redo.pop());
  }
  /** Run a structural change with undo support. */
  function change(fn, focus) {
    pushHist();
    clearTimeout(typingTimer); typingTimer = null;
    fn();
    if (!blocks.length) blocks.push({ t: "p", text: "" });
    build();
    if (focus) focusBlock(focus.i, focus.at);
    onChange();
  }

  // -- DOM --
  function curIndex() {
    const el = document.activeElement?.closest?.(".blk");
    return el && root.contains(el) ? +el.dataset.i : 0;
  }

  const BULLETS = ["•", "◦", "▪"];
  function gutter(b, i) {
    if (b.t === "ul") return h("span", { class: "gut" }, BULLETS[(b.indent || 0) % 3]);
    if (b.t === "ol") {
      let n = 1;
      for (let k = i - 1; k >= 0; k--) {
        if (blocks[k].t !== "ol" || (blocks[k].indent || 0) < (b.indent || 0)) break;
        if ((blocks[k].indent || 0) === (b.indent || 0)) n++;
      }
      return h("span", { class: "gut num" }, n + ".");
    }
    if (b.t === "todo") {
      return h("button", {
        class: "gut check" + (b.checked ? " on" : ""), tabindex: "-1", "data-no-edit": "1", title: "toggle",
        onclick: () => { change(() => { b.checked = !b.checked; }); },
      }, b.checked ? "✔" : "");
    }
    return null;
  }

  function viewHtml(b) {
    if (b.t === "hr") return "<hr>";
    if (b.t === "code") return `<pre>${esc(b.text) || "&nbsp;"}</pre>`;
    return b.text ? inline(b.text) : '<span class="ph"></span>';
  }

  function blockEl(b, i) {
    const ta = h("textarea", { class: "in", rows: "1", spellcheck: "true", autocomplete: "off", "aria-label": b.t, placeholder: PLACEHOLDER[b.t] || "" });
    ta.value = b.text;
    const view = h("div", { class: "view" });
    view.innerHTML = viewHtml(b);
    const el = h("div", { class: `blk t-${b.t}` + (b.checked ? " done" : "") + (b.t === "code" ? " mono" : ""), "data-i": i, style: `--indent:${b.indent || 0}` },
      gutter(b, i), view, ta);
    if (b.t === "hr") ta.tabIndex = -1;
    view.addEventListener("mousedown", (e) => {
      if (e.target.closest("a")) return;
      e.preventDefault();
      goal = null;
      focusBlock(i, "end");
    });
    ta.addEventListener("focus", () => { el.classList.add("editing"); fit(ta); });
    ta.addEventListener("blur", () => {
      if (menu && menu.owner === ta) setTimeout(() => { if (document.activeElement !== ta) closeMenu(); }, 0);
      if (!el.isConnected) return;
      el.classList.remove("editing");
      view.innerHTML = viewHtml(blocks[i] || b);
    });
    ta.addEventListener("input", () => onInput(i, ta));
    ta.addEventListener("keydown", (e) => onKey(e, i, ta));
    ta.addEventListener("paste", (e) => onPaste(e, i, ta));
    return el;
  }

  function build() {
    root.replaceChildren(...blocks.map(blockEl));
    root.querySelectorAll("textarea").forEach(fit);
  }

  function fit(ta) {
    if (!ta.offsetParent) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  function focusBlock(i, at = "end") {
    i = Math.max(0, Math.min(blocks.length - 1, i));
    const el = root.children[i];
    const ta = el?.querySelector("textarea");
    if (!ta) return;
    el.classList.add("editing");
    ta.focus({ preventScroll: true });
    fit(ta);
    const n = typeof at === "number" ? Math.min(at, ta.value.length) : at === "start" ? 0 : ta.value.length;
    ta.setSelectionRange(n, n);
    const r = el.getBoundingClientRect(), box = root.closest(".scroll")?.getBoundingClientRect();
    if (box && (r.bottom > box.bottom - 24 || r.top < box.top + 24)) el.scrollIntoView({ block: "nearest" });
  }

  // -- caret geometry (to know when ArrowUp/Down should leave the block, and to keep the column when they do) --
  function measure(ta) {
    const cs = getComputedStyle(ta);
    for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "whiteSpace", "wordBreak", "overflowWrap", "tabSize", "paddingLeft", "paddingRight"]) mirror.style[p] = cs[p];
    mirror.style.width = ta.clientWidth + "px";
    const lh = parseFloat(cs.lineHeight) || 20;
    /** visual line number (0-based) of the caret if it sat at offset p */
    const line = (p) => { mirror.textContent = ta.value.slice(0, p) + "\u200b"; return Math.round(mirror.scrollHeight / lh) - 1; };
    return { line, lh };
  }
  /** smallest offset whose visual line is >= n (line numbers never decrease with the offset) */
  function firstOffsetOnLine(ta, line, n) {
    let lo = 0, hi = ta.value.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (line(mid) >= n) hi = mid; else lo = mid + 1; }
    return lo;
  }
  function caretRow(ta) {
    const { line } = measure(ta);
    const here = line(ta.selectionStart), last = line(ta.value.length);
    return { first: here === 0, last: here === last, col: ta.selectionStart - firstOffsetOnLine(ta, line, here) };
  }
  /** Put the caret on the first/last visual line of block i, `col` characters in. */
  function focusOnLine(i, which, col) {
    focusBlock(i, "start");
    const ta = root.children[i]?.querySelector("textarea");
    if (!ta) return;
    const { line } = measure(ta);
    const lastLine = line(ta.value.length);
    const n = which === "first" ? 0 : lastLine;
    const start = firstOffsetOnLine(ta, line, n);
    const end = n < lastLine ? firstOffsetOnLine(ta, line, n + 1) - 1 : ta.value.length;
    const at = Math.min(start + col, end);
    ta.setSelectionRange(at, at);
  }

  // -- input handling --
  function onInput(i, ta) {
    const b = blocks[i];
    if (!typingTimer) pushHist(i);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingTimer = null; }, 1200);
    b.text = ta.value;
    goal = null;
    fit(ta);
    if (b.t === "p") {
      for (const [re, make] of SHORTCUTS) {
        const m = ta.value.match(re);
        if (!m) continue;
        const spec = make(m);
        clearTimeout(typingTimer); typingTimer = null;
        pushHist(i);
        Object.assign(b, spec, { text: "" });
        if (spec.t === "hr") blocks.splice(i + 1, 0, { t: "p", text: "" });
        build();
        focusBlock(spec.t === "hr" ? i + 1 : i, "start");
        onChange();
        return;
      }
    }
    const sl = ta.value.match(/^\/([\w ]{0,15})$/);
    if (sl && b.t === "p") openMenu(i, ta, sl[1]); else closeMenu();
    onChange();
  }

  function onPaste(e, i, ta) {
    const text = e.clipboardData?.getData("text/plain") || "";
    const b = blocks[i];
    if (!text.includes("\n") || b.t === "code") return;
    e.preventDefault();
    const parsed = parseMd(text);
    let last = i;
    change(() => {
      const before = ta.value.slice(0, ta.selectionStart), after = ta.value.slice(ta.selectionEnd);
      if (!before && !after) { blocks.splice(i, 1, ...parsed); last = i + parsed.length - 1; return; }
      const merged = parsed[0].t === "p" && !isListType(b.t);
      if (merged) { b.text = before + parsed.shift().text; } else b.text = before;
      const tail = after ? [{ ...(isListType(b.t) ? b : { t: "p" }), text: after, checked: false }] : [];
      blocks.splice(i + 1, 0, ...parsed, ...tail);
      last = i + parsed.length;
    });
    focusBlock(last, "end");
  }

  function onKey(e, i, ta) {
    const b = blocks[i];
    if (!/^(ArrowUp|ArrowDown|Shift|Control|Alt|Meta)$/.test(e.key)) goal = null;
    const mod = e.ctrlKey || e.metaKey;
    const start = ta.selectionStart, end = ta.selectionEnd;

    if (menu && menu.owner === ta && menuKey(e)) return;

    if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y")) { e.preventDefault(); redoIt(); return; }
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); wrap(ta, "**"); return; }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); wrap(ta, "*"); return; }
    if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); wrap(ta, "`"); return; }
    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (b.t === "todo") change(() => { b.checked = !b.checked; }, { i, at: start });
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (j < 0 || j >= blocks.length) return;
      change(() => { [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }, { i: j, at: start });
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); ta.blur(); onExit("escape"); return; }

    if (e.key === "Enter" && !e.shiftKey && !mod && !e.isComposing) {
      e.preventDefault();
      if (b.t === "code") {
        if (start === ta.value.length && ta.value.endsWith("\n")) {
          change(() => { b.text = b.text.replace(/\n$/, ""); blocks.splice(i + 1, 0, { t: "p", text: "" }); }, { i: i + 1, at: "start" });
        } else {
          document.execCommand("insertText", false, "\n");
        }
        return;
      }
      if (b.t === "hr") { change(() => blocks.splice(i + 1, 0, { t: "p", text: "" }), { i: i + 1, at: "start" }); return; }
      if (isListType(b.t) && !b.text) {
        if (b.indent) change(() => { b.indent--; }, { i, at: 0 });
        else change(() => { b.t = "p"; delete b.checked; }, { i, at: 0 });
        return;
      }
      const left = ta.value.slice(0, start), right = ta.value.slice(end);
      const next = isListType(b.t) ? { t: b.t, indent: b.indent || 0, checked: false } : { t: "p" };
      change(() => { b.text = left; blocks.splice(i + 1, 0, { ...next, text: right }); }, { i: i + 1, at: "start" });
      return;
    }

    if (e.key === "Backspace" && start === 0 && end === 0 && !mod) {
      if (b.t !== "p") { e.preventDefault(); change(() => { b.t = "p"; b.indent = 0; delete b.checked; }, { i, at: 0 }); return; }
      if (i > 0) {
        e.preventDefault();
        const prev = blocks[i - 1];
        if (prev.t === "hr") change(() => blocks.splice(i - 1, 1), { i: i - 1, at: "start" });
        else if (prev.t === "code") focusBlock(i - 1, "end");
        else {
          const at = prev.text.length;
          change(() => { prev.text += b.text; blocks.splice(i, 1); }, { i: i - 1, at });
        }
      }
      return;
    }
    if (e.key === "Delete" && start === ta.value.length && end === start && i < blocks.length - 1 && b.t !== "code") {
      const nx = blocks[i + 1];
      e.preventDefault();
      if (nx.t === "hr") change(() => blocks.splice(i + 1, 1), { i, at: start });
      else if (nx.t !== "code") change(() => { b.text += nx.text; blocks.splice(i + 1, 1); }, { i, at: start });
      return;
    }

    if (e.key === "Tab" && !mod) {
      e.preventDefault();
      if (b.t === "code") { document.execCommand("insertText", false, "  "); return; }
      if (isListType(b.t)) {
        const d = e.shiftKey ? -1 : 1, n = Math.max(0, Math.min(4, (b.indent || 0) + d));
        if (n !== (b.indent || 0)) change(() => { b.indent = n; }, { i, at: start });
      }
      return;
    }

    if (!e.shiftKey && !mod && !e.altKey) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const up = e.key === "ArrowUp", row = caretRow(ta);
        if (up ? row.first : row.last) {
          e.preventDefault();
          if (up && i === 0) { onExit("up"); return; }
          if (!up && i === blocks.length - 1) return;
          goal ??= row.col;
          focusOnLine(up ? i - 1 : i + 1, up ? "last" : "first", goal);
        }
        return;
      }
      if (e.key === "ArrowLeft" && start === 0 && end === 0 && i > 0) { e.preventDefault(); focusBlock(i - 1, "end"); return; }
      if (e.key === "ArrowRight" && start === ta.value.length && end === start && i < blocks.length - 1) { e.preventDefault(); focusBlock(i + 1, "start"); return; }
    }
  }

  function wrap(ta, mark) {
    const a = ta.selectionStart, z = ta.selectionEnd, sel = ta.value.slice(a, z);
    document.execCommand("insertText", false, mark + sel + mark);
    ta.setSelectionRange(a + mark.length, a + mark.length + sel.length);
  }

  // -- "/" block menu --
  function openMenu(i, ta, q) {
    const words = q.toLowerCase().split(" ").filter(Boolean);
    const items = MENU.filter((m) => words.every((w) => m.keys.includes(w) || m.label.toLowerCase().includes(w)));
    if (!items.length) { closeMenu(); return; }
    if (!menu) {
      menu = { el: h("div", { class: "slash" }), sel: 0, owner: ta, i, items };
      document.body.append(menu.el);
    }
    Object.assign(menu, { items, owner: ta, i });
    menu.sel = Math.min(menu.sel, items.length - 1);
    const r = ta.getBoundingClientRect();
    menu.el.style.left = r.left + "px";
    menu.el.style.top = Math.min(r.bottom + 4, innerHeight - 280) + "px";
    paintMenu();
  }
  function paintMenu() {
    menu.el.replaceChildren(...menu.items.map((m, n) => h("div", {
      class: "slash-item" + (n === menu.sel ? " sel" : ""),
      onmousedown: (e) => { e.preventDefault(); pick(m); },
    }, h("b", {}, m.label), h("span", { class: "dim" }, m.sub))));
  }
  function closeMenu() { menu?.el.remove(); menu = null; }
  function menuKey(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      menu.sel = (menu.sel + (e.key === "ArrowDown" ? 1 : -1) + menu.items.length) % menu.items.length;
      paintMenu();
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(menu.items[menu.sel]); return true; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); return true; }
    return false;
  }
  function pick(m) {
    const i = menu.i;
    closeMenu();
    change(() => {
      const b = blocks[i];
      Object.assign(b, { t: m.t, text: "" });
      if (m.t === "todo") b.checked = false;
      if (m.t === "hr") blocks.splice(i + 1, 0, { t: "p", text: "" });
    }, { i: m.t === "hr" ? i + 1 : i, at: "start" });
  }

  // click on empty space under the last block -> edit/append there
  root.addEventListener("mousedown", (e) => {
    if (e.target !== root) return;
    e.preventDefault();
    const last = blocks[blocks.length - 1];
    if (last.t === "p" && !last.text) focusBlock(blocks.length - 1, "end");
    else change(() => blocks.push({ t: "p", text: "" }), { i: blocks.length, at: "start" });
  });

  return {
    load(md) { blocks = parseMd(md); hist = []; redo = []; build(); },
    markdown: () => toMd(blocks),
    isEmpty: () => blocks.length === 1 && blocks[0].t === "p" && !blocks[0].text,
    headings: () => blocks.flatMap((b, i) => (/^h[123]$/.test(b.t) ? [{ i, level: +b.t[1], text: plain(b.text) }] : [])),
    focus: (i = 0, at = "start") => focusBlock(i, at),
    focusEnd: () => focusBlock(blocks.length - 1, "end"),
    jump(i) {
      const el = root.children[Math.max(0, Math.min(blocks.length - 1, i))];
      el?.scrollIntoView({ block: "center" });
      el?.classList.add("flash");
      setTimeout(() => el?.classList.remove("flash"), 1200);
      focusBlock(i, "end");
    },
    destroy() { closeMenu(); mirror.remove(); },
  };
}
