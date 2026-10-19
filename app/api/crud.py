from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from ..auth import require_user
from ..db import get_session


def crud_router(prefix: str, model: type[SQLModel], order_by: Any, touch: str | None = None) -> APIRouter:
    """Generic list/get/create/patch/delete router. `touch` names a datetime field bumped on update."""
    from ..models import utcnow

    router = APIRouter(prefix=prefix, dependencies=[Depends(require_user)])

    @router.get("")
    def list_items(session: Session = Depends(get_session)):
        return session.exec(select(model).order_by(order_by)).all()

    @router.post("", status_code=201)
    def create(data: dict, session: Session = Depends(get_session)):
        obj = model.model_validate(_coerce(model, data))
        session.add(obj)
        session.commit()
        session.refresh(obj)
        return obj

    @router.patch("/{item_id}")
    def update(item_id: int, data: dict, session: Session = Depends(get_session)):
        obj = session.get(model, item_id)
        if not obj:
            raise HTTPException(404)
        for k, v in _coerce(model, data).items():
            if k != "id" and k in model.model_fields:
                setattr(obj, k, v)
        if touch:
            setattr(obj, touch, utcnow())
        session.add(obj)
        session.commit()
        session.refresh(obj)
        return obj

    @router.delete("/{item_id}", status_code=204)
    def delete(item_id: int, session: Session = Depends(get_session)):
        obj = session.get(model, item_id)
        if not obj:
            raise HTTPException(404)
        session.delete(obj)
        session.commit()

    return router


def _coerce(model: type[SQLModel], data: dict) -> dict:
    """Parse ISO strings into aware UTC datetimes for datetime fields."""
    from datetime import datetime, timezone

    out = dict(data)
    for name, field in model.model_fields.items():
        if name in out and isinstance(out[name], str) and "datetime" in str(field.annotation):
            dt = datetime.fromisoformat(out[name].replace("Z", "+00:00"))
            out[name] = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return out
