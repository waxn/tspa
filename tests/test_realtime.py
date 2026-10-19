import asyncio
from datetime import timedelta

from sqlmodel import Session, select

from app import push, scheduler
from app.db import engine
from app.events import Broadcaster
from app.models import PushSubscription, Reminder, utcnow


def test_events_and_config_require_login(client):
    assert client.get("/api/events").status_code == 401
    assert client.get("/api/config").status_code == 401
    assert client.post("/api/push/subscribe", json={}).status_code == 401


def test_config(authed):
    c = authed.get("/api/config").json()
    assert c["tz"] == "America/New_York" and c["ai"] is False


def test_check_due_fires_once_and_publishes(authed, monkeypatch):
    sent = []
    monkeypatch.setattr(scheduler, "send_push", lambda p: sent.append(p))
    events = []
    monkeypatch.setattr(scheduler.bus, "publish", lambda e: events.append(e))
    with Session(engine) as s:
        s.add(Reminder(text="due now", fire_at=utcnow() - timedelta(seconds=5)))
        s.add(Reminder(text="later", fire_at=utcnow() + timedelta(hours=1)))
        s.commit()
    assert asyncio.run(scheduler.check_due()) == 1
    assert asyncio.run(scheduler.check_due()) == 0
    assert [p["text"] for p in sent] == ["due now"]
    assert {"type": "reminder", "id": events[0]["id"], "text": "due now"} == events[0]
    with Session(engine) as s:
        done = {r.text: r.fired_at for r in s.exec(select(Reminder)).all()}
    assert done["due now"] and done["later"] is None


def test_broadcaster_fanout():
    async def run():
        b = Broadcaster()
        a, c = b.subscribe(), b.subscribe()
        b.publish({"n": 1})
        assert await a.get() == {"n": 1} and await c.get() == {"n": 1}
        b.unsubscribe(a)
        b.publish({"n": 2})
        assert a.empty() and await c.get() == {"n": 2}

    asyncio.run(run())


def test_push_subscribe_upsert_and_remove(authed):
    body = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "k1", "auth": "a1"}}
    assert authed.post("/api/push/subscribe", json=body).status_code == 201
    body["keys"]["auth"] = "a2"
    assert authed.post("/api/push/subscribe", json=body).status_code == 201
    with Session(engine) as s:
        subs = s.exec(select(PushSubscription)).all()
        assert len(subs) == 1 and subs[0].auth == "a2"
    assert authed.post("/api/push/unsubscribe", json={"endpoint": body["endpoint"]}).status_code == 200
    assert authed.post("/api/push/unsubscribe", json={"endpoint": body["endpoint"]}).status_code == 404


def test_send_push_drops_dead_subscriptions(authed, monkeypatch):
    from pywebpush import WebPushException

    class Resp:
        status_code = 410

    def gone(**kw):
        raise WebPushException("gone", response=Resp())

    monkeypatch.setattr(push, "webpush", gone)
    monkeypatch.setattr(push.get_settings(), "vapid_private_key", "x")
    with Session(engine) as s:
        s.add(PushSubscription(endpoint="https://p/1", p256dh="a", auth="b"))
        s.commit()
    push.send_push({"id": 1, "text": "hi"})
    with Session(engine) as s:
        assert s.exec(select(PushSubscription)).all() == []


def test_vapid_keys_sign():
    from py_vapid import Vapid

    from app.gen_vapid import b64
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    priv = b64(key.private_numbers().private_value.to_bytes(32, "big"))
    v = Vapid.from_string(priv)
    assert v.sign({"sub": "mailto:a@b.co", "aud": "https://push.example"})["Authorization"]
