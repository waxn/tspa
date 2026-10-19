from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from ..auth import require_user
from ..config import get_settings
from ..db import get_session
from ..events import bus
from ..models import Note, Project, Reminder, StreamEntry, Task
from ..parser import ai
from ..parser.rules import KINDS, ParseResult, parse

router = APIRouter(prefix="/api/quickadd", dependencies=[Depends(require_user)])


class PreviewIn(BaseModel):
    text: str
    force_kind: str | None = None
    use_ai: bool = False


class CommitIn(BaseModel):
    kind: str
    title: str
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


@router.post("/preview")
def preview(body: PreviewIn, session: Session = Depends(get_session)):
    tz = get_settings().tz
    now = datetime.now(ZoneInfo(tz))
    names = list(session.exec(select(Project.name)).all())
    result = parse(body.text, now=now, tz=tz, force_kind=body.force_kind)
    if result.kind in ("todo", "assignment", "reminder") and not result.project:
        first = result.title.split(" ", 1)[0].lower()
        match = next((n for n in names if len(n) >= 3 and n.lower() == first), None)
        if match:
            result.project = match
    low = result.confidence < 0.5
    if body.use_ai and low:
        smart = ai.parse_ai(body.text, now, tz, names)
        if smart:
            result = smart
    return {**result.to_dict(), "low_confidence": low and result.source == "rules", "ai_available": ai.available()}


@router.post("/commit", status_code=201)
def commit(body: CommitIn, session: Session = Depends(get_session)):
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
        obj = Note(title=title, project_id=pid)
    elif body.kind == "stream":
        obj = StreamEntry(body=title)
    else:
        if _find_project(session, title):
            raise HTTPException(409, "project exists")
        obj = Project(name=title)
    session.add(obj)
    session.commit()
    session.refresh(obj)
    bus.publish({"type": "changed"})
    return {"kind": body.kind, "item": obj}
