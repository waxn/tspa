from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.parser.rules import parse

Z = ZoneInfo("America/New_York")
NOW = datetime(2026, 10, 19, 10, 0, tzinfo=Z)  # a Monday


def L(*a):  # local datetime helper
    return datetime(*a, tzinfo=Z)


# (text, kind, title, due_at, fire_at, project, priority)
CASES = [
    ("Bio project due 10/24", "assignment", "Bio project", L(2026, 10, 24, 23, 59), None, None, 0),
    ("va state test 2hr", "reminder", "va state test", None, L(2026, 10, 19, 12, 0), None, 0),
    ("call mom in 30 min", "reminder", "call mom", None, L(2026, 10, 19, 10, 30), None, 0),
    ("stretch 1h30m", "reminder", "stretch", None, L(2026, 10, 19, 11, 30), None, 0),
    ("check oven in 45m", "reminder", "check oven", None, L(2026, 10, 19, 10, 45), None, 0),
    ("remind me to take pills at 3pm", "reminder", "take pills", None, L(2026, 10, 19, 15, 0), None, 0),
    ("remind me to call dad at 9am", "reminder", "call dad", None, L(2026, 10, 20, 9, 0), None, 0),
    ("dentist tomorrow 8am", "reminder", "dentist", None, L(2026, 10, 20, 8, 0), None, 0),
    ("essay due friday", "assignment", "essay", L(2026, 10, 23, 23, 59), None, None, 0),
    ("english paper due friday 5pm", "assignment", "english paper", L(2026, 10, 23, 17, 0), None, None, 0),
    ("math hw due tomorrow", "assignment", "math hw", L(2026, 10, 20, 23, 59), None, None, 0),
    ("lab report by oct 30", "assignment", "lab report", L(2026, 10, 30, 23, 59), None, None, 0),
    ("buy milk", "todo", "buy milk", None, None, None, 0),
    ("buy milk tomorrow", "todo", "buy milk", L(2026, 10, 20, 23, 59), None, None, 0),
    ("finish slides due 11/2 #bio !!", "todo", "finish slides", L(2026, 11, 2, 23, 59), None, "bio", 2),
    ("fix bike !!!", "todo", "fix bike", None, None, None, 3),
    ("n: idea for a flight tracker", "note", "idea for a flight tracker", None, None, None, 0),
    ("i: feeling stuck on calc", "stream", "feeling stuck on calc", None, None, None, 0),
    ("> random thought about runways", "stream", "random thought about runways", None, None, None, 0),
    ("p: Cessna build", "project", "Cessna build", None, None, None, 0),
    ("t: read ch 4 due monday", "todo", "read ch 4", L(2026, 10, 26, 23, 59), None, None, 0),
    ("r: standup at 2pm", "reminder", "standup", None, L(2026, 10, 19, 14, 0), None, 0),
    ("due in 3 days chem quiz", "assignment", "chem quiz", L(2026, 10, 22, 23, 59), None, None, 0),
    ("submit form 1 hour", "reminder", "submit form", None, L(2026, 10, 19, 11, 0), None, 0),
]


@pytest.mark.parametrize("text,kind,title,due,fire,project,prio", CASES)
def test_parse(text, kind, title, due, fire, project, prio):
    r = parse(text, now=NOW)
    assert (r.kind, r.title) == (kind, title)
    assert r.due_at == due and r.fire_at == fire
    assert r.project == project and r.priority == prio


def test_confidence_levels():
    assert parse("buy milk", now=NOW).confidence >= 0.8
    assert parse("Bio project due 10/24", now=NOW).confidence >= 0.9
    assert parse("sometime next month maybe", now=NOW).confidence < 0.5  # unparsed time words -> AI-eligible
    assert parse("r: something", now=NOW).confidence < 0.5  # reminder with no time


def test_force_kind():
    r = parse("call mom 2hr", now=NOW, force_kind="todo")
    assert r.kind == "todo" and r.due_at == L(2026, 10, 19, 12, 0)


def test_unparseable_due_keeps_text():
    r = parse("write essay on Hamlet", now=NOW)
    assert r.kind == "todo" and r.title == "write essay on Hamlet" and r.due_at is None


def test_to_dict_is_utc():
    d = parse("va state test 2hr", now=NOW).to_dict()
    assert d["fire_at"] == "2026-10-19T16:00:00Z"
