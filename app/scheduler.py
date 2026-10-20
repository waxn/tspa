import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlmodel import Session, select

from .db import engine
from .events import bus
from .models import Reminder, utcnow
from .api.widgets import poll_all
from .push import send_push


async def check_due() -> int:
    """Fire every reminder whose time has come. DB is the source of truth, so restarts and edits just work."""
    now = utcnow()
    with Session(engine) as session:
        due = session.exec(select(Reminder).where(Reminder.fired_at == None, Reminder.fire_at <= now)).all()  # noqa: E711
        payloads = []
        for r in due:
            r.fired_at = now
            session.add(r)
            payloads.append({"type": "reminder", "id": r.id, "text": r.text})
        session.commit()
    for p in payloads:
        bus.publish(p)
        await asyncio.to_thread(send_push, p)
    if payloads:
        bus.publish({"type": "changed"})
    return len(payloads)


def make_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler()
    sched.add_job(check_due, "interval", seconds=10, max_instances=1, coalesce=True, next_run_time=utcnow())
    sched.add_job(poll_all, "interval", seconds=30, max_instances=1, coalesce=True, next_run_time=utcnow())
    return sched
