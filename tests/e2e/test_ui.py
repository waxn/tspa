"""Real server + real Chromium. Everything here is done with the keyboard unless a test says otherwise.
Skipped if Chromium isn't available. Screenshots land in $TSPA_SHOTS (default /tmp/tspa-shots)."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")
from app.auth import hasher  # noqa: E402

CHROMIUM = next((p for p in ["/opt/pw-browsers/chromium"] if os.path.exists(p)), None)
SHOTS = Path(os.environ.get("TSPA_SHOTS", "/tmp/tspa-shots"))
PASSWORD = "e2e-pass"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def fake_service():
    """A tiny 'self-hosted service': /stats needs an API key and returns JSON; / just answers."""
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/stats":
                if self.headers.get("x-api-key") != "k123":
                    self.send_response(401); self.end_headers(); return
                body = json.dumps({"photos": 48213, "usage": 73014444032}).encode()
                self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)
            else:
                self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    port = free_port()
    db = tmp_path_factory.mktemp("db") / "e2e.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}", "PASSWORD_HASH": hasher.hash(PASSWORD), "SECRET_KEY": "e2e"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    proc.terminate()
    proc.wait(5)


@pytest.fixture(scope="module")
def browser():
    if not CHROMIUM:
        pytest.skip("no chromium")
    SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
        yield b
        b.close()


def login(browser, server, **ctx_kw):
    ctx = browser.new_context(viewport={"width": 1400, "height": 850}, permissions=["notifications"], **ctx_kw)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" else None)
    pg.goto(server + "/login")
    pg.fill("input[name=password]", PASSWORD)
    pg.click("button")
    pg.wait_for_selector("body[data-ready='1']")
    return pg


@pytest.fixture(scope="module")
def page(browser, server):
    pg = login(browser, server)
    yield pg
    assert pg.errors == [], pg.errors
    pg.context.close()


def api_get(page, path):
    return page.evaluate("p => fetch(p).then(r => r.json())", path)


def capture(page, text, enter=True):
    page.keyboard.press("Space")
    page.wait_for_selector(".capture")
    page.keyboard.type(text)
    if enter:
        page.keyboard.press("Enter")
        page.wait_for_selector(".capture", state="detached")


def go_home(page):
    page.keyboard.press("1")
    page.wait_for_selector(".hgrid")


# ---------------------------------------------------------------------------------------------------

def test_wrong_password_rejected(browser, server):
    pg = browser.new_page()
    pg.goto(server + "/login")
    pg.fill("input[name=password]", "nope")
    pg.click("button")
    assert pg.url.endswith("/login?error=1")
    assert pg.is_visible("text=wrong password")
    pg.close()


def test_starts_empty_and_dark(page):
    assert page.get_attribute("html", "data-theme") == "dark"
    assert "inbox zero" in page.inner_text("#p-inbox")
    page.screenshot(path=str(SHOTS / "home-empty.png"))


def test_capture_routes_by_content(page):
    capture(page, "bio lab due friday 5pm #bio !!")
    capture(page, "call mom in 2h")
    capture(page, "n: idea for a flight tracker")
    capture(page, "my flight tracker could use ADS-B feeds from a cheap SDR")
    page.wait_for_function("document.querySelectorAll('#p-tasks .row').length === 2")
    tasks = page.inner_text("#p-tasks")
    assert "bio lab" in tasks and "call mom" in tasks
    assert "flight tracker could use" in page.inner_text("#p-inbox")
    assert "idea for a flight tracker" in page.inner_text("#p-notes")
    assert "1" in page.inner_text("#inbox-count")


def test_capture_preview_and_tab_forces_type(page):
    page.keyboard.press("Space")
    page.keyboard.type("dentist stuff")
    page.wait_for_function("document.querySelector('.cap-preview')?.textContent.includes('thought')")
    page.keyboard.press("Tab")  # auto -> todo
    page.wait_for_function("document.querySelector('.cap-preview b')?.textContent === 'todo'")
    page.screenshot(path=str(SHOTS / "capture.png"))
    page.keyboard.press("Escape")
    # closing keeps the text: nothing is lost
    page.keyboard.press("Space")
    assert page.input_value(".cap-input") == "dentist stuff"
    page.keyboard.press("Control+a"); page.keyboard.press("Backspace"); page.keyboard.press("Escape")
    page.keyboard.press("Space")
    assert page.input_value(".cap-input") == ""
    page.keyboard.press("Escape")


def test_undo_last_capture(page):
    before = len(api_get(page, "/api/tasks"))
    capture(page, "buy milk tomorrow")
    page.wait_for_function(f"document.querySelectorAll('#p-tasks .row').length === {before + 2}")  # + the call-mom reminder
    page.keyboard.press("u")
    page.wait_for_function(f"document.querySelectorAll('#p-tasks .row').length === {before + 1}")
    assert len(api_get(page, "/api/tasks")) == before


def test_home_keyboard_navigation_and_done(page):
    go_home(page)
    assert "focus" in page.get_attribute("#p-tasks", "class")
    page.keyboard.press("ArrowRight")
    assert "focus" in page.get_attribute("#p-inbox", "class")
    page.keyboard.press("ArrowDown")  # inbox has one row, so this moves down to notes
    assert "focus" in page.get_attribute("#p-notes", "class")
    page.keyboard.press("ArrowLeft")
    assert "focus" in page.get_attribute("#p-tasks", "class")
    page.keyboard.press("ArrowDown")  # reminder -> bio lab (today first, then this week)
    page.keyboard.press("x")
    page.wait_for_function("document.querySelectorAll('#p-tasks .row').length === 1")
    done = [t for t in api_get(page, "/api/tasks") if t["done_at"]]
    assert [t["title"] for t in done] == ["bio lab"]
    page.keyboard.press("u")
    page.wait_for_function("document.querySelectorAll('#p-tasks .row').length === 2")


def test_inbox_triage_with_keyboard(page):
    page.keyboard.press("4")
    page.wait_for_selector(".detail")
    assert "ADS-B" in page.inner_text(".detail")
    page.screenshot(path=str(SHOTS / "inbox.png"))
    page.keyboard.press("t")
    page.wait_for_selector(".form")
    assert "ADS-B" in page.input_value(".form input[type=text]")
    page.keyboard.press("Control+a"); page.keyboard.type("Look into ADS-B feeds friday")
    page.keyboard.press("Enter")
    page.wait_for_selector(".form", state="detached")
    page.wait_for_function("document.querySelector('.empty')?.textContent.includes('inbox zero')")
    assert any(t["title"].startswith("Look into ADS-B") for t in api_get(page, "/api/tasks"))
    assert api_get(page, "/api/stream") == []


def test_tasks_view_edit_with_natural_language_date(page):
    page.keyboard.press("3")
    page.wait_for_selector(".page.narrow .row")
    page.keyboard.press("n")
    page.wait_for_selector(".form")
    page.keyboard.type("write essay")
    page.keyboard.press("Tab")
    page.keyboard.type("tomorrow 5pm")
    page.wait_for_function("document.querySelector('.fhint.ok')")
    assert "5:00 PM" in page.inner_text(".fhint.ok")
    page.keyboard.press("Enter")
    page.wait_for_selector(".form", state="detached")
    t = next(t for t in api_get(page, "/api/tasks") if t["title"] == "write essay")
    assert t["due_at"]
    page.screenshot(path=str(SHOTS / "tasks.png"))
    page.keyboard.press("Escape")  # leaves the tasks view
    page.wait_for_selector(".hgrid")


# ---- notes editor --------------------------------------------------------------------------------

def test_note_editor_shortcuts_produce_markdown(page):
    page.keyboard.press("2")
    page.wait_for_selector(".nlist")
    page.keyboard.press("n")
    page.wait_for_selector(".doc-title:focus")
    page.keyboard.type("Flight plan")
    page.keyboard.press("Enter")
    for chunk in ["## ", "Goals", "Enter", "- ", "one", "Enter", "two", "Tab", "Enter", "Enter", "Enter",
                  "[] ", "order SDR", "Enter", "Enter", "> ", "line of sight", "Enter", "---", "### ", "Parts", "Enter",
                  "Use **bold** and `code` here", "Enter", "1. ", "first", "Enter", "second", "Enter", "Enter"]:
        page.keyboard.press(chunk) if chunk in ("Enter", "Tab") else page.keyboard.type(chunk)
    page.wait_for_function("document.querySelector('.saved').textContent === 'saved'")
    body = next(n for n in api_get(page, "/api/notes") if n["title"] == "Flight plan")["body"]
    assert body == ("## Goals\n\n- one\n  - two\n- [ ] order SDR\n\n> line of sight\n\n---\n\n### Parts\n\n"
                    "Use **bold** and `code` here\n\n1. first\n2. second\n"), body
    page.keyboard.press("Escape")
    # rendered view: heading, nested bullet, checkbox, bold, outline
    assert page.inner_text(".blocks .t-h2 .view") == "Goals"
    assert page.query_selector(".blocks b")
    assert [e.inner_text() for e in page.query_selector_all(".oitem")] == ["Goals", "Parts"]
    page.screenshot(path=str(SHOTS / "notes.png"))


def blocks(page):
    return page.evaluate("[...document.querySelectorAll('.blocks .blk')].map(b => [b.className.split(' ')[1], b.querySelector('textarea').value])")


def click_below(page):
    """Click the empty space under the last block: that starts a new paragraph (like Notion)."""
    box = page.locator(".blocks").bounding_box()
    page.mouse.click(box["x"] + 10, box["y"] + box["height"] - 10)
    page.wait_for_selector(".blk.editing")


click_last_block = click_below


def test_editor_backspace_merge_and_undo(page):
    page.click(".nlist >> text=Flight plan")
    page.wait_for_selector(".blk.editing")
    click_last_block(page)
    assert blocks(page)[-1] == ["t-p", ""]
    page.keyboard.type("tail")
    page.keyboard.press("Home")
    page.keyboard.press("Backspace")  # paragraph start: merges into the block above ("second")
    assert blocks(page)[-1] == ["t-ol", "secondtail"]
    page.keyboard.press("Control+z")  # one undo step restores the split
    assert blocks(page)[-2:] == [["t-ol", "second"], ["t-p", "tail"]]
    page.keyboard.press("Control+Shift+z")
    assert blocks(page)[-1] == ["t-ol", "secondtail"]
    page.keyboard.press("Home")
    page.keyboard.press("Backspace")  # list item start: becomes a paragraph first
    assert blocks(page)[-1][0] == "t-p"
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")  # back to where we started: tail gone
    assert blocks(page)[-1] == ["t-p", ""]
    page.keyboard.press("Escape")


def test_arrow_keys_cross_block_boundaries(page):
    click_last_block(page)
    page.keyboard.press("ArrowUp")
    assert page.evaluate("document.activeElement.closest('.blk').className.includes('t-ol')")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowUp")
    assert page.evaluate("document.activeElement.closest('.blk').querySelector('textarea').value") == "Use **bold** and `code` here"
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Escape")


def test_slash_menu_and_outline_updates(page):
    click_last_block(page)
    page.keyboard.type("/head")
    page.wait_for_selector(".slash")
    page.screenshot(path=str(SHOTS / "slash.png"))
    page.keyboard.press("Enter")  # "Heading 1" is the first match
    page.keyboard.type("Appendix")
    page.wait_for_function("document.querySelector('.saved').textContent === 'saved'")
    body = next(n for n in api_get(page, "/api/notes") if n["title"] == "Flight plan")["body"]
    assert body.rstrip().endswith("# Appendix"), body
    assert [e.inner_text() for e in page.query_selector_all(".oitem")][-1] == "Appendix"
    page.keyboard.press("Escape")


def test_move_block_and_todo_toggle(page):
    page.click(".blocks .t-todo .view")
    page.keyboard.press("Control+Enter")
    page.wait_for_selector(".blk.t-todo.done")
    page.keyboard.press("Alt+ArrowUp")
    page.wait_for_function("document.querySelector('.blocks .blk:nth-child(3)').className.includes('t-todo')")
    page.wait_for_function("document.querySelector('.saved').textContent === 'saved'")
    body = next(n for n in api_get(page, "/api/notes") if n["title"] == "Flight plan")["body"]
    assert "- [x] order SDR" in body
    page.keyboard.press("Alt+ArrowDown")
    page.keyboard.press("Escape")


def test_palette_finds_headings_and_notes(page):
    go_home(page)
    page.keyboard.press("/")
    page.keyboard.type("#parts")
    page.wait_for_selector(".pal-row.sel .ptype.heading")
    page.screenshot(path=str(SHOTS / "palette.png"))
    page.keyboard.press("Enter")
    page.wait_for_function("location.hash.startsWith('#/notes/')")
    assert page.evaluate("document.activeElement.value") == "Parts"
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.wait_for_selector(".hgrid")
    page.keyboard.press("/")
    page.keyboard.type("flight")
    rows = page.inner_text(".pal-list")
    assert "Flight plan" in rows and "idea for a flight tracker" in rows
    page.keyboard.press("Escape")


def test_note_survives_reload_and_deep_link(page):
    nid = next(n for n in api_get(page, "/api/notes") if n["title"] == "Flight plan")["id"]
    page.goto(page.url.split("#")[0] + f"#/notes/{nid}")
    page.reload()
    page.wait_for_selector("body[data-ready='1']")
    page.wait_for_selector(".doc-title")
    assert page.input_value(".doc-title") == "Flight plan"
    assert blocks(page)[0] == ["t-h2", "Goals"]  # the first block is being edited, so it is a textarea
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")


def test_empty_untitled_note_is_not_left_behind(page):
    n0 = len(api_get(page, "/api/notes"))
    page.keyboard.press("2")
    page.keyboard.press("n")
    page.wait_for_selector(".doc-title:focus")
    page.keyboard.press("Escape")
    page.keyboard.press("1")
    page.wait_for_selector(".hgrid")
    page.wait_for_function(f"fetch('/api/notes').then(r => r.json()).then(n => n.length === {n0})")


# ---- services ------------------------------------------------------------------------------------

def test_add_service_tiles_and_down_alert(page, fake_service):
    page.keyboard.press("5")
    page.keyboard.press("n")
    page.wait_for_selector(".form")
    page.select_option(".form select >> nth=0", "immich")
    t = page.query_selector_all(".form input[type=text]")
    t[1].fill(fake_service + "/stats")
    page.fill(".form textarea >> nth=0", "x-api-key: k123")
    page.click("text=test it")
    page.wait_for_selector(".probe-item")
    page.click(".probe-item:has-text('photos')")  # adds a line to the values box
    page.screenshot(path=str(SHOTS / "widget-form.png"))
    page.fill(".form textarea >> nth=1", "Photos | photos | num\nStorage | usage | bytes")
    page.keyboard.press("Control+Enter")
    page.wait_for_selector(".card")
    for name, url in [("Router", fake_service + "/"), ("NAS", "http://127.0.0.1:9/")]:
        page.keyboard.press("n")
        page.wait_for_selector(".form")
        t = page.query_selector_all(".form input[type=text]")
        t[0].fill(name)
        t[1].fill(url)
        page.keyboard.press("Enter")
        page.wait_for_selector(f".card:has-text('{name}')")
    page.wait_for_function("document.querySelectorAll('.card .dot.up').length === 2 && document.querySelectorAll('.card .dot.down').length === 1")
    cards = page.inner_text(".cards")
    assert "48,213" in cards and "68.0 GB" in cards and "DOWN" in cards and "UP" in cards
    assert page.is_visible("#down")  # header alert
    page.screenshot(path=str(SHOTS / "services.png"))
    go_home(page)
    assert "1 down" in page.inner_text("#p-services .pmeta")
    page.screenshot(path=str(SHOTS / "home.png"))


# ---- misc ----------------------------------------------------------------------------------------

def test_theme_toggle_via_palette_persists(page):
    page.keyboard.press("/")
    page.keyboard.type(">theme")
    page.keyboard.press("Enter")
    page.wait_for_function("document.documentElement.dataset.theme === 'light'")
    page.screenshot(path=str(SHOTS / "light.png"))
    page.reload()
    page.wait_for_selector("body[data-ready='1']")
    assert page.get_attribute("html", "data-theme") == "light"
    page.keyboard.press("/")
    page.keyboard.type(">theme")
    page.keyboard.press("Enter")
    page.wait_for_function("document.documentElement.dataset.theme === 'dark'")


def test_help_overlay(page):
    page.keyboard.press("?")
    page.wait_for_selector(".help")
    assert "capture a thought" in page.inner_text(".help")
    page.keyboard.press("Escape")
    page.wait_for_selector(".help", state="detached")


def test_no_horizontal_scroll_on_phone(browser, server):
    pg = login(browser, server, is_mobile=True, has_touch=True)
    pg.set_viewport_size({"width": 390, "height": 800})
    pg.reload()
    pg.wait_for_selector("body[data-ready='1']")
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    assert pg.is_visible("#fab")
    pg.tap("#fab")
    pg.wait_for_selector(".capture")
    pg.keyboard.type("from my phone")
    pg.keyboard.press("Enter")
    pg.wait_for_selector(".capture", state="detached")
    pg.screenshot(path=str(SHOTS / "phone.png"))
    for v in ("notes", "tasks", "inbox", "services"):
        pg.click(f"#tabs a[data-v={v}]")
        pg.wait_for_function(f"location.hash.startsWith('#/{v}')")
        assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), v
    assert pg.errors == [], pg.errors
    pg.context.close()


def test_share_target_opens_capture(browser, server):
    pg = login(browser, server)
    pg.goto(server + "/?title=Cool+page&url=https://example.com/x")
    pg.wait_for_selector(".capture")
    assert "Cool page" in pg.input_value(".cap-input") and "example.com" in pg.input_value(".cap-input")
    pg.close()


def test_ai_suggestion_chip_and_accept(page):
    """The server fills in summary/suggest in the background; here we plant a finished result and check the UI side."""
    suggest = json.dumps({"kind": "todo", "title": "Email Mr. Lee about the lab", "due_at": None, "fire_at": None,
                          "project": "bio", "priority": 1, "confidence": 0.7, "source": "ai"})
    page.evaluate("""s => fetch('/api/stream', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({body: 'ugh need to ask lee about the lab thing', summary: 'Ask Mr. Lee about lab', tags: 'bio school', suggest: s})})""", suggest)
    go_home(page)
    page.wait_for_selector("#p-inbox .chip:has-text('→ todo')")
    assert "Ask Mr. Lee about lab" in page.inner_text("#p-inbox")  # the summary, not the raw rambling
    page.keyboard.press("4")
    page.wait_for_selector(".suggest")
    assert "Email Mr. Lee about the lab" in page.inner_text(".suggest")
    page.keyboard.press("Enter")  # accept as-is
    page.wait_for_function("fetch('/api/tasks').then(r => r.json()).then(t => t.some(x => x.title === 'Email Mr. Lee about the lab'))")
    t = next(t for t in api_get(page, "/api/tasks") if t["title"] == "Email Mr. Lee about the lab")
    assert t["priority"] == 1 and t["project_id"]
    assert not any(e["summary"] == "Ask Mr. Lee about lab" for e in api_get(page, "/api/stream"))  # the thought was consumed
    page.keyboard.press("u")  # and it's reversible: the thought comes back with its suggestion
    page.wait_for_function("fetch('/api/stream').then(r => r.json()).then(l => l.some(e => e.summary === 'Ask Mr. Lee about lab' && e.suggest))")
    assert not any(t["title"] == "Email Mr. Lee about the lab" for t in api_get(page, "/api/tasks"))
    page.keyboard.press("1")


def test_note_html_and_script_links_are_inert(page):
    page.evaluate("""() => fetch('/api/notes', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({title: 'xss', body: '<img src=x onerror="window.__pwned=1"> [click](javascript:window.__pwned=2) [ok](https://example.com) <script>window.__pwned=3</script>'})})""")
    page.keyboard.press("2")
    page.click(".nrow >> text=xss")
    page.keyboard.press("Escape")
    page.wait_for_selector(".blocks .view")
    assert page.evaluate("window.__pwned") is None
    html = page.inner_html(".blocks")
    assert "<img" not in html and "<script" not in html and "javascript:" not in html.replace("&amp;", "&").split("[click]")[0]
    assert page.query_selector(".blocks a[href='https://example.com']")
    assert not page.query_selector(".blocks a[href^='javascript']")
    page.keyboard.press("Escape")


def test_toasts_never_pile_up(page):
    go_home(page)
    for i in range(6):
        capture(page, f"thought number {i}")
    assert page.evaluate("document.querySelectorAll('#toasts .toast').length") <= 3


def test_arrows_walk_wrapped_lines_before_leaving_block(page):
    long = "word " * 120
    page.evaluate("""b => fetch('/api/notes', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({title: 'wrap', body: 'first\\n\\n' + b + '\\n\\nlast'})})""", long.strip())
    page.keyboard.press("2")
    page.click(".nrow >> text=wrap")
    page.wait_for_selector(".blk.editing")
    idx = lambda: page.evaluate("+document.activeElement.closest('.blk').dataset.i")
    page.click(".blocks .blk:nth-child(3) .view")  # "last"
    assert idx() == 2
    page.keyboard.press("ArrowUp")
    assert idx() == 1  # entered the long paragraph from below
    lines = page.evaluate("(() => { const t = document.activeElement; return Math.round(t.scrollHeight / parseFloat(getComputedStyle(t).lineHeight)); })()")
    assert lines >= 4, lines
    for _ in range(lines - 2):
        page.keyboard.press("ArrowUp")
        assert idx() == 1  # still walking up through the wrapped lines
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowUp")
    assert idx() == 0  # now it leaves the block
    for _ in range(lines + 2):
        page.keyboard.press("ArrowDown")
    assert idx() == 2
    page.keyboard.press("Escape")


def test_arrows_keep_column_between_blocks(page):
    page.evaluate("""() => fetch('/api/notes', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({title: 'cols', body: 'hello world\\n\\nab\\n\\nabcdefghijk'})})""")
    page.keyboard.press("2")
    page.click(".nrow >> text=cols")
    page.click(".blocks .blk:nth-child(3) .view")  # last block, caret goes to the end (col 11)
    page.keyboard.press("Home")
    for _ in range(5):
        page.keyboard.press("ArrowRight")
    caret = lambda: page.evaluate("[+document.activeElement.closest('.blk').dataset.i, document.activeElement.selectionStart]")
    assert caret() == [2, 5]
    page.keyboard.press("ArrowUp")
    assert caret() == [1, 2]  # "ab" is shorter than column 5: clamps to its end
    page.keyboard.press("ArrowUp")
    assert caret()[0] == 0
    page.keyboard.press("Home")
    for _ in range(7):
        page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    assert caret() == [2, 7]
    page.keyboard.press("Escape")
