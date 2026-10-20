"""Dashboard tiles for self-hosted services. The server does the polling (keeps API keys off the browser and
sidesteps CORS), so tspa must be able to reach the services it watches."""
import asyncio
import json
import time
from collections import deque
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import require_user
from ..db import engine, get_session
from ..events import bus
from ..models import Widget

router = APIRouter(prefix="/api/widgets", dependencies=[Depends(require_user)])

MAX_BYTES = 1_000_000
TIMEOUT = 6.0
HISTORY = 48  # checks kept per widget (30s apart -> 24 min)

# widget id -> latest result; lives in memory, so it resets on restart (that is fine for a status board)
state: dict[int, dict] = {}
_history: dict[int, deque] = {}


def dig(obj, path: str):
    """'a.b.0.c' -> obj['a']['b'][0]['c'] (None when anything is missing)."""
    for part in filter(None, path.split(".")):
        if isinstance(obj, dict):
            obj = obj.get(part)
        elif isinstance(obj, list) and part.lstrip("-").isdigit() and -len(obj) <= int(part) < len(obj):
            obj = obj[int(part)]
        else:
            return None
        if obj is None:
            return None
    return obj


def flatten(obj, prefix="", depth=0, out=None):
    out = [] if out is None else out
    if len(out) >= 80:
        return out
    if isinstance(obj, dict) and depth < 4:
        for k, v in obj.items():
            flatten(v, f"{prefix}.{k}" if prefix else str(k), depth + 1, out)
    elif isinstance(obj, list) and depth < 4:
        out.append({"path": prefix, "value": f"[{len(obj)} items]"})
        for i, v in enumerate(obj[:5]):
            flatten(v, f"{prefix}.{i}" if prefix else str(i), depth + 1, out)
    elif prefix:
        out.append({"path": prefix, "value": obj})
    return out


def _check_url(url: str) -> None:
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(422, "url must start with http:// or https://")


_tasks: set[asyncio.Task] = set()
FIELDS = ("name", "kind", "url", "headers", "fields", "pos")


def _clean(data: dict) -> dict:
    out = {k: data[k] for k in FIELDS if k in data}
    for k in ("headers", "fields"):
        if k in out and not isinstance(out[k], str):
            out[k] = json.dumps(out[k])
        if k in out:
            try:
                json.loads(out[k] or "null")
            except ValueError:
                raise HTTPException(422, f"{k} must be valid JSON")
    if out.get("kind", "status") not in ("status", "stat"):
        raise HTTPException(422, "kind must be status or stat")
    if "url" in out:
        _check_url(out["url"])
    if "name" in out and not str(out["name"]).strip():
        raise HTTPException(422, "name required")
    return out


def _check_soon() -> None:
    t = asyncio.create_task(poll_all())
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


@router.get("")
def list_widgets(session: Session = Depends(get_session)):
    return session.exec(select(Widget).order_by(Widget.pos, Widget.id)).all()


@router.post("", status_code=201)
async def create(data: dict, session: Session = Depends(get_session)):
    clean = _clean(data)
    if not clean.get("name") or not clean.get("url"):
        raise HTTPException(422, "name and url required")
    w = Widget(**clean)
    session.add(w)
    session.commit()
    session.refresh(w)
    bus.publish({"type": "changed"})
    _check_soon()
    return w


@router.patch("/{wid}")
async def update(wid: int, data: dict, session: Session = Depends(get_session)):
    w = session.get(Widget, wid)
    if not w:
        raise HTTPException(404)
    for k, v in _clean(data).items():
        setattr(w, k, v)
    session.add(w)
    session.commit()
    session.refresh(w)
    bus.publish({"type": "changed"})
    _check_soon()
    return w


@router.delete("/{wid}", status_code=204)
def delete(wid: int, session: Session = Depends(get_session)):
    w = session.get(Widget, wid)
    if not w:
        raise HTTPException(404)
    session.delete(w)
    session.commit()
    state.pop(wid, None)
    _history.pop(wid, None)
    bus.publish({"type": "changed"})


def _headers(raw: str) -> dict[str, str]:
    try:
        h = json.loads(raw or "{}")
        return {str(k): str(v) for k, v in h.items()} if isinstance(h, dict) else {}
    except ValueError:
        return {}


async def fetch(client: httpx.AsyncClient, url: str, headers: dict, want_json: bool):
    """-> (http_status, latency_ms, parsed_json_or_None). Raises on network errors."""
    t0 = time.perf_counter()
    async with client.stream("GET", url, headers=headers, follow_redirects=True) as r:
        body = b""
        if want_json:
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    break
        ms = round((time.perf_counter() - t0) * 1000)
        data = None
        if want_json and body:
            try:
                data = json.loads(body)
            except ValueError:
                data = None
        return r.status_code, ms, data


async def check(w: Widget, client: httpx.AsyncClient) -> None:
    res: dict = {"up": False, "ms": None, "values": [], "error": "", "at": datetime.now(timezone.utc).isoformat()}
    try:
        code, ms, data = await fetch(client, w.url, _headers(w.headers), w.kind == "stat")
        res["ms"], res["up"] = ms, code < 400
        if code >= 400:
            res["error"] = f"HTTP {code}"
        if w.kind == "stat":
            try:
                fields = json.loads(w.fields or "[]")
            except ValueError:
                fields = []
            res["values"] = [{**f, "value": dig(data, f.get("path", ""))} for f in fields if isinstance(f, dict)]
            if res["up"] and data is None:
                res["error"] = "not JSON"
    except httpx.TimeoutException:
        res["error"] = "timeout"
    except httpx.HTTPError as e:
        res["error"] = type(e).__name__
    except Exception as e:  # never let one bad tile break the poller
        res["error"] = str(e)[:80]
    hist = _history.setdefault(w.id, deque(maxlen=HISTORY))
    hist.append(1 if res["up"] else 0)
    res["history"] = list(hist)
    state[w.id] = res


async def poll_all() -> None:
    with Session(engine) as session:
        widgets = session.exec(select(Widget)).all()
    for gone in set(state) - {w.id for w in widgets}:
        state.pop(gone, None)
        _history.pop(gone, None)
    if not widgets:
        return
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        await asyncio.gather(*(check(w, client) for w in widgets))
    bus.publish({"type": "widgets"})


@router.get("/state")
def get_state():
    return state


@router.post("/refresh")
async def refresh():
    await poll_all()
    return state


class ProbeIn(BaseModel):
    url: str
    headers: str = "{}"


@router.post("/probe")
async def probe(body: ProbeIn):
    """Fetch a URL once and list the values found in its JSON, to help pick fields for a stat tile."""
    _check_url(body.url)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            code, ms, data = await fetch(client, body.url, _headers(body.headers), True)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"could not reach it: {type(e).__name__}")
    return {"status": code, "ms": ms, "json": data is not None, "fields": flatten(data) if data is not None else []}
