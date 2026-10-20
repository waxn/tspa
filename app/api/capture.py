"""One-line capture. Anything decisive (a prefix, a date/time, a #project, !!) becomes the right item at once;
everything else is saved as a thought in the inbox and, if AI is configured, summarised and sorted in the background."""
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from ..auth import require_user
from ..config import get_settings
from ..db import engine, get_session
from ..events import bus
from ..models import Note, Project, Reminder, StreamEntry, Task, utcnow
from ..parser import ai
from ..parser.rules import KINDS, ParseResult, parse

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


class CaptureIn(BaseModel):
    text: str
    kind: str | None = None  # force a type (the Tab key in the capture bar)


class ItemIn(BaseModel):
    kind: str
    title: str
    body: str = ""
    due_at: datetime | None = None
    fire_at: datetime | None = None
    project: str | None = None
    priority: int = 0


def _utc(d: datetime | None) -> datetime | None:
    if d is None:
        return None
    return d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _find_project(session: Session, name: str) -> Project | None:
    return session.exec(select(Project).where(func.lower(Project.name) == name.lower())).first()


def decide(raw: str, forced: str | None, session: Session) -> ParseResult:
    """Rule-parse `raw`; fall back to a plain thought unless the text carried a clear signal."""
    tz = get_settings().tz
    now = datetime.now(ZoneInfo(tz))
    result = parse(raw, now=now, tz=tz, force_kind=forced if forced in KINDS else None)
    if result.kind in ("todo", "assignment", "reminder") and not result.project:
        first = result.title.split(" ", 1)[0].lower()
        names = session.exec(select(Project.name)).all()
        if first and any(len(n) >= 3 and n.lower() == first for n in names):
            result.project = next(n for n in names if n.lower() == first)
    if forced in KINDS:
        return result
    decisive = result.confidence >= 0.9 or result.priority > 0 or result.project
    if decisive and not (result.kind == "reminder" and not result.fire_at):
        return result
    unresolved_reminder = result.kind == "reminder" and not result.fire_at and result.confidence < 0.5
    text = result.title if unresolved_reminder and result.title else raw.strip()
    return ParseResult("stream", text, confidence=0.5)


def create_item(session: Session, body: ItemIn) -> tuple[str, object]:
    if body.kind not in KINDS:
        raise HTTPException(422, "bad kind")
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "empty title")
    pid = None
    if body.project and body.kind != "project":
        proj = _find_project(session, body.project)
        if not proj:
            proj = Project(name=body.project)
            session.add(proj)
            session.flush()
        pid = proj.id
    if body.kind in ("todo", "assignment"):
        obj = Task(title=title, kind=body.kind, due_at=_utc(body.due_at), priority=body.priority, project_id=pid)
    elif body.kind == "reminder":
        if not body.fire_at:
            raise HTTPException(422, "reminder needs a time")
        obj = Reminder(text=title, fire_at=_utc(body.fire_at))
    elif body.kind == "note":
        obj = Note(title=title, body=body.body, project_id=pid)
    elif body.kind == "stream":
        obj = StreamEntry(body=title)
    else:
        if _find_project(session, title):
            raise HTTPException(409, "project exists")
        obj = Project(name=title)
    session.add(obj)
    return body.kind, obj


def _enrich(entry_id: int) -> None:
    tz = get_settings().tz
    with Session(engine) as session:
        entry = session.get(StreamEntry, entry_id)
        if not entry:
            return
        text, names = entry.body, list(session.exec(select(Project.name)).all())
    res = ai.enrich(text, datetime.now(ZoneInfo(tz)), tz, names)
    if not res:
        return
    with Session(engine) as session:
        entry = session.get(StreamEntry, entry_id)
        if not entry:  # deleted or converted while the model was thinking
            return
        entry.summary, entry.tags = res["summary"], res["tags"]
        entry.suggest = json.dumps(res["suggest"]) if res["suggest"] else ""
        session.add(entry)
        session.commit()
    bus.publish({"type": "changed"})


@router.post("/capture/preview")
def preview(body: CaptureIn, session: Session = Depends(get_session)):
    r = decide(body.text, body.kind, session)
    return {**r.to_dict(), "thought": r.kind == "stream" and body.kind != "stream", "ai": ai.available()}


@router.post("/capture", status_code=201)
def capture(body: CaptureIn, tasks: BackgroundTasks, session: Session = Depends(get_session)):
    if not body.text.strip():
        raise HTTPException(422, "empty")
    r = decide(body.text, body.kind, session)
    kind, obj = create_item(session, ItemIn(kind=r.kind, title=r.title, due_at=r.due_at, fire_at=r.fire_at,
                                            project=r.project, priority=r.priority))
    session.commit()
    session.refresh(obj)
    bus.publish({"type": "changed"})
    if kind == "stream" and ai.available():
        tasks.add_task(_enrich, obj.id)
    return {"kind": kind, "item": obj}


@router.post("/stream/{entry_id}/convert", status_code=201)
def convert(entry_id: int, body: ItemIn, session: Session = Depends(get_session)):
    """Turn an inbox thought into a real item; the thought is consumed."""
    entry = session.get(StreamEntry, entry_id)
    if not entry:
        raise HTTPException(404)
    if body.kind == "note" and not body.body:
        body.body = entry.body
    kind, obj = create_item(session, body)
    session.delete(entry)
    session.commit()
    session.refresh(obj)
    bus.publish({"type": "changed"})
    return {"kind": kind, "item": obj}
