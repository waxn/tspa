"""Optional LLM helpers (any OpenAI-compatible API). Never required: everything works on the rule parser alone."""
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
_calls: list[float] = []

SYSTEM = """You help organise one captured thought from a student's personal memory app. Reply with JSON only.
Schema: {"summary": str, "tags": [str], "suggest": null | {"kind": "todo|assignment|reminder|note|project",
"title": str, "due": "YYYY-MM-DDTHH:MM" or null, "remind_at": "YYYY-MM-DDTHH:MM" or null, "project": str or null,
"priority": 0-3}}
summary: a headline of at most 8 words (for a long dump, the gist). tags: 0-3 short lowercase words.
suggest: only when the thought clearly is something to do (todo), schoolwork with a deadline (assignment), something to
be reminded of at a time (reminder, set remind_at), or a longer idea worth a page (note). Otherwise null.
Times are the user's local time. Keep suggest.title short, without the date words."""


def _key() -> str:
    s = get_settings()
    return s.ai_api_key or s.openrouter_api_key


def _model() -> str:
    s = get_settings()
    return s.ai_model or s.openrouter_model


def available() -> bool:
    s = get_settings()
    local = not s.ai_base_url.startswith("https://openrouter.ai")
    return bool(_model() and (_key() or local))


def _budget() -> bool:
    cutoff = time.time() - 86400
    _calls[:] = [t for t in _calls if t > cutoff]
    if len(_calls) >= get_settings().ai_daily_limit:
        return False
    _calls.append(time.time())
    return True


def _chat(messages: list[dict]) -> str:
    s = get_settings()
    client = OpenAI(base_url=s.ai_base_url, api_key=_key() or "none", timeout=20)
    resp = client.chat.completions.create(model=_model(), messages=messages, temperature=0)
    return resp.choices[0].message.content or ""


def _local(v, zone: ZoneInfo) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v).replace(tzinfo=zone)
    except (TypeError, ValueError):
        return None


def enrich(text: str, now: datetime, tz: str, projects: list[str]) -> dict | None:
    """-> {"summary", "tags", "suggest": ParseResult-dict | None} or None when AI is off/failed/over budget."""
    if not available() or not _budget():
        return None
    zone = ZoneInfo(tz)
    now = now.astimezone(zone)
    user = f"Now: {now:%A %Y-%m-%d %H:%M} ({tz}). Existing projects: {', '.join(projects) or 'none'}.\nThought: {text}"
    try:
        raw = _chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        suggest = None
        sg = data.get("suggest")
        if isinstance(sg, dict) and sg.get("kind") in KINDS and str(sg.get("title", "")).strip():
            suggest = ParseResult(
                kind=sg["kind"], title=str(sg["title"]).strip(), due_at=_local(sg.get("due"), zone),
                fire_at=_local(sg.get("remind_at"), zone), project=sg.get("project") or None,
                priority=max(0, min(3, int(sg.get("priority") or 0))), confidence=0.7, source="ai",
            ).to_dict()
            if suggest["kind"] == "reminder" and not suggest["fire_at"]:
                suggest = None
        tags = [re.sub(r"[^\w-]", "", str(t).lower()) for t in (data.get("tags") or [])][:3]
        return {"summary": str(data.get("summary") or "").strip()[:120], "tags": " ".join(t for t in tags if t), "suggest": suggest}
    except Exception as e:  # network, rate limit, bad JSON: the thought is already saved, so just skip
        log.warning("ai enrich failed: %s", e)
        return None
