"""Optional LLM fallback via OpenRouter. Only used for low-confidence input, on explicit request."""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from openai import OpenAI

from ..config import get_settings
from .rules import KINDS, ParseResult

log = logging.getLogger("tspa.ai")
DAILY_LIMIT = 40  # free OpenRouter accounts get ~50 requests/day
_calls: list[float] = []

SYSTEM = """You turn one line of text from a student's productivity app into JSON. Reply with JSON only.
Schema: {"kind": "todo|assignment|reminder|note|stream|project", "title": str,
"due": "YYYY-MM-DDTHH:MM" or null, "remind_at": "YYYY-MM-DDTHH:MM" or null, "project": str or null, "priority": 0-3}
kind: assignment = schoolwork with a due date; reminder = notify at a time (use remind_at); todo = a task;
note/stream = free thoughts. Times are local to the user. Keep title short, without the date words."""


def available() -> bool:
    s = get_settings()
    return bool(s.openrouter_api_key and s.openrouter_model)


def _chat(messages: list[dict]) -> str:
    s = get_settings()
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=s.openrouter_api_key, timeout=10)
    resp = client.chat.completions.create(model=s.openrouter_model, messages=messages, temperature=0)
    return resp.choices[0].message.content or ""


def _local(v, zone: ZoneInfo) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v).replace(tzinfo=zone)
    except (TypeError, ValueError):
        return None


def parse_ai(text: str, now: datetime, tz: str, projects: list[str]) -> ParseResult | None:
    if not available():
        return None
    cutoff = time.time() - 86400
    _calls[:] = [t for t in _calls if t > cutoff]
    if len(_calls) >= DAILY_LIMIT:
        return None
    _calls.append(time.time())
    zone = ZoneInfo(tz)
    now = now.astimezone(zone)
    user = f"Now: {now:%A %Y-%m-%d %H:%M} ({tz}). Existing projects: {', '.join(projects) or 'none'}.\nText: {text}"
    try:
        raw = _chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        kind = data["kind"]
        if kind not in KINDS or not str(data.get("title", "")).strip():
            return None
        return ParseResult(
            kind=kind, title=str(data["title"]).strip(), due_at=_local(data.get("due"), zone),
            fire_at=_local(data.get("remind_at"), zone), project=data.get("project") or None,
            priority=max(0, min(3, int(data.get("priority") or 0))), confidence=0.7, source="ai",
        )
    except Exception as e:  # network, rate limit, bad JSON: fall back to rules
        log.warning("ai parse failed: %s", e)
        return None
