from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

import asyncio
import json

from ..auth import require_user
from ..config import get_settings
from ..db import get_session
from ..events import bus
from ..models import PushSubscription
from ..parser import ai

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@router.get("/config")
def config():
    s = get_settings()
    return {"tz": s.tz, "vapid_public_key": s.vapid_public_key, "ai": ai.available()}


@router.get("/events")
async def events(request: Request):
    async def gen():
        q = bus.subscribe()
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), 15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class Keys(BaseModel):
    p256dh: str
    auth: str


class SubIn(BaseModel):
    endpoint: str
    keys: Keys


@router.post("/push/subscribe", status_code=201)
def subscribe(body: SubIn, session: Session = Depends(get_session)):
    existing = session.exec(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)).first()
    if existing:
        existing.p256dh, existing.auth = body.keys.p256dh, body.keys.auth
        session.add(existing)
    else:
        session.add(PushSubscription(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth))
    session.commit()
    return {"ok": True}


@router.post("/push/unsubscribe")
def unsubscribe(body: dict, session: Session = Depends(get_session)):
    sub = session.exec(select(PushSubscription).where(PushSubscription.endpoint == body.get("endpoint"))).first()
    if not sub:
        raise HTTPException(404)
    session.delete(sub)
    session.commit()
    return {"ok": True}
