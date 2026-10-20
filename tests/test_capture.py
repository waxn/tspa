import json
from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.parser import ai


def cap(c, text, **kw):
    r = c.post("/api/capture", json={"text": text, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def preview(c, text, **kw):
    r = c.post("/api/capture/preview", json={"text": text, **kw})
    assert r.status_code == 200
    return r.json()


def test_assignment_created_directly(authed):
    out = cap(authed, "Bio project due 10/24 #bio")
    assert out["kind"] == "assignment"
    task = authed.get("/api/tasks").json()[0]
    assert task["title"] == "Bio project" and task["project_id"]
    assert authed.get("/api/projects").json()[0]["name"] == "bio"


def test_reminder_created_directly(authed):
    out = cap(authed, "va state test 2hr")
    assert out["kind"] == "reminder"
    fire = datetime.fromisoformat(out["item"]["fire_at"].replace("Z", "+00:00"))
    assert timedelta(minutes=118) < fire - datetime.now(timezone.utc) < timedelta(minutes=122)


def test_plain_text_becomes_inbox_thought(authed):
    out = cap(authed, "my flight tracker idea: use ADS-B feeds")
    assert out["kind"] == "stream"
    e = authed.get("/api/stream").json()[0]
    assert e["body"] == "my flight tracker idea: use ADS-B feeds" and e["triaged"] is False
    assert authed.get("/api/tasks").json() == []


def test_hashtags_survive_in_thoughts_but_project_hint_is_decisive(authed):
    assert cap(authed, "fix bike !!!")["kind"] == "todo"
    assert preview(authed, "vague #idea thing")["kind"] == "todo"  # a #project is a decisive signal


def test_prefixes_and_forced_kind(authed):
    assert cap(authed, "n: idea one")["kind"] == "note"
    assert cap(authed, "i: thinking")["kind"] == "stream"
    assert cap(authed, "p: Cessna build")["kind"] == "project"
    assert cap(authed, "just a plain line", kind="todo")["kind"] == "todo"
    assert authed.get("/api/notes").json()[0]["title"] == "idea one"


def test_reminder_without_time_is_kept_as_thought(authed):
    out = cap(authed, "r: something")
    assert out["kind"] == "stream" and out["item"]["body"] == "something"


def test_project_inferred_from_first_word(authed):
    authed.post("/api/projects", json={"name": "Bio"})
    assert preview(authed, "bio lab due friday")["project"] == "Bio"


def test_empty_capture_rejected(authed):
    assert authed.post("/api/capture", json={"text": "   "}).status_code == 422


def test_preview_marks_thoughts(authed):
    assert preview(authed, "random musing")["thought"] is True
    assert preview(authed, "buy milk tomorrow")["thought"] is False


def test_convert_thought(authed):
    eid = cap(authed, "email Mr. Lee about the lab")["item"]["id"]
    r = authed.post(f"/api/stream/{eid}/convert", json={"kind": "todo", "title": "email Mr. Lee", "priority": 1})
    assert r.status_code == 201
    assert authed.get("/api/stream").json() == []
    assert authed.get("/api/tasks").json()[0]["title"] == "email Mr. Lee"

    eid = cap(authed, "long rambly idea about sensors")["item"]["id"]
    authed.post(f"/api/stream/{eid}/convert", json={"kind": "note", "title": "Sensors"})
    n = authed.get("/api/notes").json()[0]
    assert n["title"] == "Sensors" and n["body"] == "long rambly idea about sensors"
    assert authed.post("/api/stream/999/convert", json={"kind": "todo", "title": "x"}).status_code == 404


def test_create_validation(authed):
    assert authed.post("/api/stream/1/convert").status_code == 422  # no body
    eid = cap(authed, "some thought")["item"]["id"]
    for body in ({"kind": "reminder", "title": "x"}, {"kind": "nope", "title": "x"}, {"kind": "todo", "title": " "}):
        assert authed.post(f"/api/stream/{eid}/convert", json=body).status_code == 422


@pytest.fixture
def ai_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_api_key", "k")
    monkeypatch.setattr(s, "ai_model", "some/model:free")
    ai._calls.clear()


def test_thought_is_enriched_in_background(authed, ai_on, monkeypatch):
    reply = {"summary": "Flight tracker idea", "tags": ["Aviation", "ideas!"],
             "suggest": {"kind": "note", "title": "Flight tracker", "due": None, "remind_at": None, "project": None, "priority": 0}}
    monkeypatch.setattr(ai, "_chat", lambda m: "Sure!\n" + json.dumps(reply))
    cap(authed, "flight tracker idea with ADS-B")
    e = authed.get("/api/stream").json()[0]  # TestClient runs background tasks before returning
    assert e["summary"] == "Flight tracker idea" and e["tags"] == "aviation ideas"
    assert json.loads(e["suggest"])["kind"] == "note"


def test_enrich_failures_leave_thought_alone(authed, ai_on, monkeypatch):
    def boom(m):
        raise RuntimeError("down")

    monkeypatch.setattr(ai, "_chat", boom)
    cap(authed, "something to remember")
    e = authed.get("/api/stream").json()[0]
    assert e["body"] == "something to remember" and e["summary"] == "" and e["suggest"] == ""


def test_enrich_budget_and_bad_suggestions(ai_on, monkeypatch):
    from datetime import datetime
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(ai, "_chat", lambda m: json.dumps({"summary": "s", "tags": [], "suggest": {"kind": "reminder", "title": "x"}}))
    assert ai.enrich("x", now, "America/New_York", [])["suggest"] is None  # reminder without a time is dropped
    monkeypatch.setattr(get_settings(), "ai_daily_limit", 1)
    assert ai.enrich("x", now, "America/New_York", []) is None  # budget (one call already used)


def test_ai_off_by_default(authed):
    assert ai.available() is False
    assert authed.get("/api/config").json()["ai"] is False


def test_ai_available_for_local_endpoint_without_key(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(s, "ai_model", "llama3")
    assert ai.available()
    monkeypatch.setattr(s, "ai_base_url", "https://openrouter.ai/api/v1")
    assert not ai.available()  # hosted endpoint needs a key
