import json
import logging

from pywebpush import WebPushException, webpush
from sqlmodel import Session, select

from .config import get_settings
from .db import engine
from .models import PushSubscription

log = logging.getLogger("tspa.push")


def send_push(payload: dict) -> None:
    """Send a silent Web Push to every subscribed browser. No-op without VAPID keys."""
    s = get_settings()
    if not s.vapid_private_key:
        return
    body = json.dumps({"title": "tspa reminder", "body": payload.get("text", ""), "id": payload.get("id")})
    with Session(engine) as session:
        for sub in session.exec(select(PushSubscription)).all():
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=body,
                    vapid_private_key=s.vapid_private_key,
                    vapid_claims={"sub": s.vapid_subject},
                )
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):
                    session.delete(sub)
                else:
                    log.warning("push failed: %s", e)
            except Exception as e:  # network etc.; never break the scheduler
                log.warning("push error: %s", e)
        session.commit()
