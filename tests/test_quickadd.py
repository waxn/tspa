from datetime import datetime, timedelta, timezone

from app.parser import ai


def preview(c, text, **kw):
    r = c.post("/api/quickadd/preview", json={"text": text, **kw})
    assert r.status_code == 200
    return r.json()


def test_preview_and_commit_assignment(authed):
    p = preview(authed, "Bio project due 10/24 #bio")
    assert p["kind"] == "assignment" and p["title"] == "Bio project" and p["project"] == "bio"
    r = authed.post("/api/quickadd/commit", json=p)
    assert r.status_code == 201
    task = authed.get("/api/tasks").json()[0]
    assert task["title"] == "Bio project" and task["kind"] == "assignment" and task["project_id"]
    assert authed.get("/api/projects").json()[0]["name"] == "bio"


def test_project_inferred_from_first_word(authed):
    authed.post("/api/projects", json={"name": "Bio"})
    assert preview(authed, "bio lab due friday")["project"] == "Bio"


def test_reminder_commit(authed):
    p = preview(authed, "va state test 2hr")
    assert p["kind"] == "reminder"
    fire = datetime.fromisoformat(p["fire_at"].replace("Z", "+00:00"))
    assert timedelta(minutes=118) < fire - datetime.now(timezone.utc) < timedelta(minutes=122)
    assert authed.post("/api/quickadd/commit", json=p).status_code == 201
    assert authed.get("/api/reminders").json()[0]["text"] == "va state test"


def test_commit_validation(authed):
    assert authed.post("/api/quickadd/commit", json={"kind": "reminder", "title": "x"}).status_code == 422
    assert authed.post("/api/quickadd/commit", json={"kind": "nope", "title": "x"}).status_code == 422
    assert authed.post("/api/quickadd/commit", json={"kind": "todo", "title": "  "}).status_code == 422


def test_other_kinds(authed):
    for text in ["n: idea one", "i: thinking about stuff", "p: Cessna build"]:
        assert authed.post("/api/quickadd/commit", json=preview(authed, text)).status_code == 201
    assert authed.get("/api/notes").json()[0]["title"] == "idea one"
    assert authed.get("/api/stream").json()[0]["body"] == "thinking about stuff"
    assert authed.get("/api/projects").json()[0]["name"] == "Cessna build"
    assert authed.post("/api/quickadd/commit", json=preview(authed, "p: cessna build")).status_code == 409


def test_ai_fallback(authed, monkeypatch):
    s = ai.get_settings()
    monkeypatch.setattr(s, "openrouter_api_key", "k")
    monkeypatch.setattr(s, "openrouter_model", "some/model:free")
    ai._calls.clear()
    monkeypatch.setattr(ai, "_chat", lambda m: 'Sure! {"kind":"assignment","title":"Chem lab","due":"2026-11-03T08:00","remind_at":null,"project":"chem","priority":9}')
    text = "sometime next month maybe chem lab"
    p = preview(authed, text)
    assert p["low_confidence"] and p["ai_available"] and p["source"] == "rules"  # not called unprompted
    p = preview(authed, text, use_ai=True)
    assert p["source"] == "ai" and p["kind"] == "assignment" and p["priority"] == 3 and p["project"] == "chem"
    assert p["due_at"] == "2026-11-03T13:00:00Z"  # 08:00 EST


def test_ai_failure_falls_back_to_rules(authed, monkeypatch):
    s = ai.get_settings()
    monkeypatch.setattr(s, "openrouter_api_key", "k")
    monkeypatch.setattr(s, "openrouter_model", "m")
    ai._calls.clear()

    def boom(m):
        raise RuntimeError("429")

    monkeypatch.setattr(ai, "_chat", boom)
    assert preview(authed, "sometime next month maybe", use_ai=True)["source"] == "rules"


def test_ai_daily_limit(monkeypatch):
    import time

    s = ai.get_settings()
    monkeypatch.setattr(s, "openrouter_api_key", "k")
    monkeypatch.setattr(s, "openrouter_model", "m")
    monkeypatch.setattr(ai, "_calls", [time.time()] * ai.DAILY_LIMIT)
    monkeypatch.setattr(ai, "_chat", lambda m: pytest_fail())
    assert ai.parse_ai("x", datetime.now(timezone.utc), "America/New_York", []) is None


def pytest_fail():
    raise AssertionError("should not be called past the daily limit")
