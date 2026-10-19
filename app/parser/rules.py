"""Deterministic quick-add parser: free text -> ParseResult. No network, no AI."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import dateparser

KINDS = ("todo", "assignment", "reminder", "note", "stream", "project")

PREFIXES = {
    "n": "note", "note": "note",
    "i": "stream",
    "t": "todo", "todo": "todo",
    "a": "assignment",
    "r": "reminder",
    "p": "project",
}
ASSIGNMENT_WORDS = re.compile(
    r"\b(paper|essay|project|test|exam|quiz|homework|hw|assignment|report|lab|presentation|midterm)\b", re.I
)
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_WD_ALIASES = {"mon": 0, "tue": 1, "tues": 1, "wed": 2, "thu": 3, "thur": 3, "thurs": 3, "fri": 4}
_WD_NAMES = {n: i for i, n in enumerate(WEEKDAYS)} | _WD_ALIASES
_WD_RE = "|".join(sorted(_WD_NAMES, key=len, reverse=True))

_DATEISH = re.compile(
    r"\d|\b(today|tonight|tomorrow|tmrw|next|this|week|weekend|month|noon|midnight|"
    + _WD_RE
    + r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b",
    re.I,
)
_SIGNAL = re.compile(
    r"\bdue\b|\b(today|tonight|tomorrow|tmrw|next week|next month|noon|midnight)\b|\d\s*(am|pm)\b|\d:\d\d", re.I
)
_HAS_TIME = re.compile(
    r"\d\s*(?:am|pm)\b|\d:\d\d|\bnoon\b|\bmidnight\b|\b(?:hours?|hrs?|minutes?|mins?)\b|\d\s*[hm]\b", re.I
)
_KEYWORD = re.compile(r"\b(?:due(?:\s+(?:on|by|at))?|by|on|before)\b", re.I)
_BAREDATE = re.compile(
    r"\b(?:\d{1,2}/\d{1,2}(?:/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)\b",
    re.I,
)
_DUR_UNIT = r"(?:hours?|hrs?|h|minutes?|mins?|m|days?|d|weeks?|w)"
_DUR = re.compile(
    rf"(?<![\w/:.-])(?:in\s+)?(?P<body>(?:\d+(?:\.\d+)?\s*{_DUR_UNIT}(?![a-z])\s*){{1,3}})", re.I
)
_DUR_WORDS = re.compile(r"\b(?:in\s+)?(?P<w>half an hour|an hour|a minute|a day)\b", re.I)
_TOD = re.compile(
    rf"(?:\b(?P<day>today|tonight|tomorrow|tmrw|{_WD_RE})\s+)?(?:\bat\s+)?"
    r"\b(?P<t>\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|noon|midnight)\b",
    re.I,
)
_DAYWORD = re.compile(rf"\b(?P<day>today|tonight|tomorrow|tmrw|(?:next\s+)?(?:{_WD_RE}))\b", re.I)


@dataclass
class ParseResult:
    kind: str
    title: str
    due_at: datetime | None = None
    fire_at: datetime | None = None
    project: str | None = None
    priority: int = 0
    confidence: float = 0.8
    source: str = "rules"

    def to_dict(self) -> dict:
        def iso(d: datetime | None) -> str | None:
            return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if d else None

        return {
            "kind": self.kind, "title": self.title, "due_at": iso(self.due_at), "fire_at": iso(self.fire_at),
            "project": self.project, "priority": self.priority, "confidence": self.confidence,
            "source": self.source,
        }


def _parse_clock(t: str) -> time:
    t = t.lower().strip()
    if t == "noon":
        return time(12)
    if t == "midnight":
        return time(0)
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", t)
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    return time(h % 24, mi)


def _day_date(word: str, now: datetime, *, allow_today: bool = True):
    w = word.lower().replace("next ", "").strip()
    if w in ("today", "tonight"):
        return now.date()
    if w in ("tomorrow", "tmrw"):
        return now.date() + timedelta(days=1)
    delta = (_WD_NAMES[w] - now.weekday()) % 7
    if delta == 0 and not allow_today:
        delta = 7
    return now.date() + timedelta(days=delta)


def _find_phrase(s: str, start: int, now: datetime, zone: ZoneInfo):
    """Parse the longest date phrase beginning at s[start:]. Returns (dt, end) or None."""
    words = list(re.finditer(r"\S+", s[start:]))[:6]
    for n in range(len(words), 0, -1):
        end = start + words[n - 1].end()
        phrase = s[start:end].rstrip(".,;")
        if not _DATEISH.search(phrase):
            continue
        dt = dateparser.parse(
            phrase,
            settings={
                "PREFER_DATES_FROM": "future", "TIMEZONE": zone.key, "RETURN_AS_TIMEZONE_AWARE": True,
                "RELATIVE_BASE": now, "DATE_ORDER": "MDY",
            },
        )
        if dt is None:
            continue
        dt = dt.astimezone(zone)
        if not _HAS_TIME.search(phrase):
            dt = datetime.combine(dt.date(), time(23, 59), tzinfo=zone)
        return dt, end
    return None


def _find_due(s: str, now: datetime, zone: ZoneInfo):
    """-> (dt, (start, end)) for 'due/by/on/before <date>' or a bare date like 10/24."""
    for m in _KEYWORD.finditer(s):
        got = _find_phrase(s, m.end(), now, zone)
        if got:
            return got[0], (m.start(), got[1])
    m = _BAREDATE.search(s)
    if m:
        got = _find_phrase(s, m.start(), now, zone)
        if got:
            return got[0], (m.start(), got[1])
    return None


def _find_duration(s: str, now: datetime):
    m = _DUR.search(s)
    if m:
        delta = timedelta()
        for num, unit in re.findall(rf"(\d+(?:\.\d+)?)\s*({_DUR_UNIT})", m.group("body"), re.I):
            n, u = float(num), unit.lower()[0]
            delta += timedelta(hours=n) if u == "h" else timedelta(minutes=n) if u == "m" else (
                timedelta(days=n) if u == "d" else timedelta(weeks=n))
        return now + delta, m.span()
    m = _DUR_WORDS.search(s)
    if m:
        w = m.group("w").lower()
        delta = {"half an hour": timedelta(minutes=30), "an hour": timedelta(hours=1),
                 "a minute": timedelta(minutes=1), "a day": timedelta(days=1)}[w]
        return now + delta, m.span()
    return None


def _find_timeofday(s: str, now: datetime, zone: ZoneInfo):
    m = _TOD.search(s)
    if not m:
        return None
    clock = _parse_clock(m.group("t"))
    day = m.group("day")
    if day:
        d = _day_date(day, now, allow_today=True)
        dt = datetime.combine(d, clock, tzinfo=zone)
        if dt <= now:
            dt += timedelta(days=7 if day.lower() in _WD_NAMES else 1)
    else:
        dt = datetime.combine(now.date(), clock, tzinfo=zone)
        if dt <= now:
            dt += timedelta(days=1)
    return dt, m.span()


def _cut(s: str, spans: list[tuple[int, int]]) -> str:
    for a, b in sorted(spans, reverse=True):
        s = s[:a] + " " + s[b:]
    s = re.sub(r"\s+", " ", s).strip(" \t-,:;")
    return re.sub(r"^to\s+", "", s, flags=re.I).strip()


def parse(text: str, now: datetime | None = None, tz: str = "America/New_York",
          force_kind: str | None = None) -> ParseResult:
    zone = ZoneInfo(tz)
    now = (now or datetime.now(zone)).astimezone(zone)
    s = text.strip()
    kind: str | None = None

    if s.startswith(">"):
        kind, s = "stream", s[1:].strip()
    else:
        m = re.match(r"^(\w+):\s*", s)
        if m and m.group(1).lower() in PREFIXES:
            kind, s = PREFIXES[m.group(1).lower()], s[m.end():]
    m = re.match(r"^remind me(?:\s+(?:to|about|of))?\s+", s, re.I)
    if m:
        kind, s = kind or "reminder", s[m.end():]
    if force_kind in KINDS:
        kind = force_kind
    explicit = kind is not None

    tags = re.findall(r"(?<!\S)#([\w-]+)", s)
    s = re.sub(r"(?<!\S)#[\w-]+", " ", s)
    priority = 0
    pm = re.search(r"(?<!\S)(!{1,3})(?!\S)", s)
    if pm:
        priority = len(pm.group(1))
        s = s[:pm.start()] + " " + s[pm.end():]
    s = re.sub(r"\s+", " ", s).strip()
    project = tags[0] if tags else None

    if kind in ("note", "stream", "project"):
        return ParseResult(kind, s, project=project, priority=priority, confidence=0.95)

    # find candidate time expressions (due first so its words are not re-read as durations)
    due = _find_due(s, now, zone)
    rest, due_span = s, None
    if due:
        due_span = due[1]
        rest = s[:due_span[0]] + " " * (due_span[1] - due_span[0]) + s[due_span[1]:]
    dur = _find_duration(rest, now)
    tod = _find_timeofday(rest, now, zone)
    day = _DAYWORD.search(rest)

    if kind is None:
        if due:
            kind = "todo"
        elif dur or tod:
            kind = "reminder"
        else:
            kind = "todo"

    spans: list[tuple[int, int]] = []
    due_at = fire_at = None
    when = None  # (dt, span) of the best non-"due" time expression
    if dur:
        when = dur
    elif tod:
        when = tod
    elif day and not due:
        d = _day_date(day.group("day"), now)
        clock = time(9) if kind == "reminder" else time(23, 59)
        dt = datetime.combine(d, clock, tzinfo=zone)
        if kind == "reminder" and dt <= now:
            dt += timedelta(days=1)
        when = (dt, day.span())

    if kind == "reminder":
        pick = when or ((due[0], due_span) if due else None)
        if pick:
            fire_at = pick[0]
            spans.append(pick[1])
    else:
        if due:
            due_at, _ = due
            spans.append(due_span)
        elif when:
            due_at = when[0]
            spans.append(when[1])
        if kind == "todo" and ASSIGNMENT_WORDS.search(s) and due_at and not explicit:
            kind = "assignment"

    title = _cut(s, spans) or s
    resolved = fire_at or due_at
    if explicit:
        confidence = 0.3 if (kind == "reminder" and not fire_at) else 0.95
    elif resolved:
        confidence = 0.9
    elif _SIGNAL.search(s):
        confidence = 0.4
    else:
        confidence = 0.8
    return ParseResult(kind, title, due_at, fire_at, project, priority, confidence)
