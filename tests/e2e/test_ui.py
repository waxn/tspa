"""Browser smoke test: real server + real Chromium. Skipped if Chromium isn't available."""
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")
from app.auth import hasher  # noqa: E402

CHROMIUM = next((p for p in ["/opt/pw-browsers/chromium"] if os.path.exists(p)), None)
SHOTS = Path(os.environ.get("TSPA_SHOTS", "/tmp/tspa-shots"))
PASSWORD = "e2e-pass"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    db = tmp_path_factory.mktemp("db") / "e2e.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}", "PASSWORD_HASH": hasher.hash(PASSWORD), "SECRET_KEY": "e2e"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    yield url
    proc.terminate()
    proc.wait(5)


@pytest.fixture(scope="module")
def page(server):
    if not CHROMIUM:
        pytest.skip("no chromium")
    SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_api.sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1400, "height": 850}, permissions=["notifications"])
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.errors = errors
        pg.goto(server + "/login")
        pg.fill("input[name=password]", PASSWORD)
        pg.click("button")
        pg.wait_for_selector("body[data-ready='1']")
        yield pg
        browser.close()


def quickadd(page, text):
    page.keyboard.press("a")
    page.fill(".qa-input", text)
    page.wait_for_selector(".preview .badge")
    page.wait_for_timeout(300)
    return page.inner_text(".preview")


def test_wrong_password_rejected(server):
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
        pg = b.new_page()
        pg.goto(server + "/login")
        pg.fill("input[name=password]", "nope")
        pg.click("button")
        assert pg.url.endswith("/login?error=1")
        b.close()


def test_assignment_quickadd_with_preview(page):
    prev = quickadd(page, "Bio project due 10/24")
    assert "DUE" in prev and "Bio project" in prev and "Oct 24" in prev
    page.keyboard.press("Enter")
    page.wait_for_selector("#p-due .row")
    row = page.inner_text("#p-due .row")
    assert "Bio project" in row and "Oct 24" in row


def test_todo_keyboard_done(page):
    quickadd(page, "buy milk !!")
    page.keyboard.press("Enter")
    page.wait_for_selector("#p-todos .row")
    assert "buy milk" in page.inner_text("#p-todos")
    page.keyboard.press("1")
    page.keyboard.press("x")
    page.wait_for_function("!document.querySelector('#p-todos .row')")


def test_tab_forces_type(page):
    quickadd(page, "dentist stuff")
    page.keyboard.press("Tab")
    page.wait_for_function("document.querySelector('.preview .badge')?.textContent === 'TODO'")
    page.keyboard.press("Escape")


def test_reminder_preview_and_commit(page):
    prev = quickadd(page, "va state test 2hr")
    assert "REMIND" in prev and "va state test" in prev
    page.keyboard.press("Enter")
    page.wait_for_selector("#p-reminders .row")
    assert "va state test" in page.inner_text("#p-reminders")
    assert any(s in page.inner_text("#p-reminders") for s in ("in 2h", "in 1h"))  # ~2h countdown


def test_stream_and_note(page):
    page.keyboard.press("i")
    page.fill("#sinput", "thinking about flight sims")
    page.keyboard.press("Enter")
    page.wait_for_selector("#p-stream .row")
    page.keyboard.press("Escape")
    quickadd(page, "n: idea for a flight tracker")
    page.keyboard.press("Enter")
    page.wait_for_selector("#p-notes .row")
    assert "flight tracker" in page.inner_text("#p-notes")


def test_mouse_checkbox_and_edit(page):
    quickadd(page, "water plants")
    page.keyboard.press("Enter")
    page.wait_for_selector("#p-todos .row")
    page.click("#p-todos .row .box")
    page.wait_for_function("!document.querySelector('#p-todos .row')")
    page.keyboard.press("h")  # show completed
    page.wait_for_selector("#p-todos .row .strike")
    page.keyboard.press("h")
    page.dblclick("#p-due .row .t")
    page.wait_for_selector(".modal input")
    assert page.input_value(".modal input") == "Bio project"
    page.keyboard.press("Escape")


def test_delete_confirm_and_filter(page):
    page.keyboard.press("2")
    page.keyboard.press("/")
    page.fill(".modal input", "zzz-nothing")
    page.keyboard.press("Enter")
    assert "no matches" in page.inner_text("#p-due")
    page.keyboard.press("Escape")  # clears filter
    page.wait_for_selector("#p-due .row")
    page.keyboard.press("d")
    page.wait_for_selector(".modal button.danger")
    page.keyboard.press("n")
    page.wait_for_function("!document.querySelector('.modal')")
    assert page.query_selector("#p-due .row")
    page.keyboard.press("d")
    page.wait_for_selector(".modal button.danger")
    page.keyboard.press("y")
    page.wait_for_function("!document.querySelector('#p-due .row')")


def test_reminder_fires_popup(page):
    fire = (datetime.now(timezone.utc) + timedelta(seconds=3)).isoformat()
    page.evaluate("""async (fire) => { await fetch('/api/reminders', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: 'ping from e2e', fire_at: fire})}); }""", fire)
    page.wait_for_selector(".toast:has-text('ping from e2e')", timeout=25000)
    # a real (silent) notification was shown through the service worker
    n = page.evaluate("""async () => { const r = await navigator.serviceWorker.ready; const ns = await r.getNotifications();
        return ns.map(x => ({body: x.body, silent: x.silent})); }""")
    assert {"body": "ping from e2e", "silent": True} in n


def test_screenshots_and_no_js_errors(page, server):
    quickadd(page, "english paper due friday 5pm #eng !!")
    page.screenshot(path=str(SHOTS / "quickadd.png"))
    page.keyboard.press("Escape")
    page.keyboard.press("?")
    page.wait_for_selector(".modal")
    page.screenshot(path=str(SHOTS / "help.png"))
    page.keyboard.press("Escape")
    page.reload()
    page.wait_for_selector("body[data-ready='1']")
    page.screenshot(path=str(SHOTS / "desktop.png"))
    page.set_viewport_size({"width": 390, "height": 800})
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "phone.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert page.errors == []
